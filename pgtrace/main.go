// pgtrace — коллектор трассировки PostgreSQL в Redis.
//
// Читает CSV-логи PostgreSQL (log_destination=csvlog), в которых каждая строка —
// выполненный запрос с длительностью, и отправляет их в Redis:
//   - список последних N запросов (LPUSH + LTRIM), по умолчанию 1000 — «стек»;
//   - агрегированный срез по нормализованным запросам (кол-во, суммарное/макс. время);
//   - мета-ключи (старт коллектора, счётчики, время последнего запроса).
//
// Только стандартная библиотека: свой минимальный RESP-клиент, свой tail с учётом
// ротации/усечения лог-файла. Внешних модулей нет.
package main

import (
	"bufio"
	"encoding/csv"
	"encoding/json"
	"flag"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type config struct {
	redisAddr string
	logDir    string
	maxStack  int
	aggTop    int
	stackKey  string
	aggKey    string // sorted set: score=calls, member=нормализованный запрос
	aggMeta   string // hash: field=нормализованный запрос, value=JSON метаданных
	metaKey   string // hash: мета коллектора
	pollEvery time.Duration
}

// событие одного запроса, кладётся в стек последних N
type queryEvent struct {
	TS    string  `json:"ts"`
	User  string  `json:"user"`
	DB    string  `json:"db"`
	DurMs float64 `json:"dur_ms"`
	Query string  `json:"query"`
}

// агрегат по нормализованному запросу
type aggMetaVal struct {
	Norm    string  `json:"norm"`
	Calls   int64   `json:"calls"`
	TotalMs float64 `json:"total_ms"`
	MaxMs   float64 `json:"max_ms"`
	LastTS  string  `json:"last_ts"`
	Sample  string  `json:"sample"`
}

func main() {
	cfg := config{}
	flag.StringVar(&cfg.redisAddr, "redis", "127.0.0.1:6379", "адрес Redis host:port")
	flag.StringVar(&cfg.logDir, "logdir", `D:\1c\pglog`, "каталог CSV-логов PostgreSQL")
	flag.IntVar(&cfg.maxStack, "max", 1000, "сколько последних запросов держать в стеке")
	flag.IntVar(&cfg.aggTop, "aggtop", 500, "сколько нормализованных запросов держать в агрегации")
	flag.StringVar(&cfg.stackKey, "stackkey", "pg:trace", "ключ Redis для стека последних запросов")
	flag.StringVar(&cfg.aggKey, "aggkey", "pg:agg", "ключ Redis (sorted set) для агрегации")
	flag.StringVar(&cfg.aggMeta, "aggmeta", "pg:agg:meta", "ключ Redis (hash) для метаданных агрегации")
	flag.StringVar(&cfg.metaKey, "metakey", "pg:meta", "ключ Redis (hash) для мета коллектора")
	flag.DurationVar(&cfg.pollEvery, "poll", time.Second, "интервал опроса лога на новые строки")
	flag.Parse()

	log.SetFlags(log.LstdFlags)
	log.Printf("pgtrace: redis=%s logdir=%s max=%d", cfg.redisAddr, cfg.logDir, cfg.maxStack)

	rc := newRedis(cfg.redisAddr)
	started := time.Now().Format(time.RFC3339)
	rc.do("HSET", cfg.metaKey, "started", started, "captured", "0")

	run(cfg, rc, started, nil)
}

// run — основной цикл: следит за новейшим CSV-файлом и обрабатывает новые строки.
// Завершается при закрытии stop (для тестов); в проде stop=nil — работает вечно.
func run(cfg config, rc *redisClient, started string, stop <-chan struct{}) {
	var (
		cur      string        // текущий отслеживаемый файл
		f        *os.File      // открытый файл
		reader   *bufio.Reader // буфер поверх файла
		offset   int64         // прочитано байт
		captured int64
	)
	openNewest := func() {
		newest := newestCSV(cfg.logDir)
		if newest == "" || newest == cur {
			// возможно, текущий файл усечён при ротации — проверим
			if f != nil {
				if st, err := f.Stat(); err == nil && st.Size() < offset {
					f.Seek(0, io.SeekStart)
					reader.Reset(f)
					offset = 0
					log.Printf("файл усечён (ротация), читаю сначала: %s", cur)
				}
			}
			return
		}
		if f != nil {
			f.Close()
		}
		nf, err := os.Open(newest)
		if err != nil {
			log.Printf("не открыть %s: %v", newest, err)
			return
		}
		f = nf
		reader = bufio.NewReader(f)
		offset = 0
		cur = newest
		log.Printf("отслеживаю лог: %s", cur)
	}

	openNewest()
	tick := time.NewTicker(cfg.pollEvery)
	defer tick.Stop()
	for {
		select {
		case <-stop:
			if f != nil {
				f.Close()
			}
			return
		case <-tick.C:
		}
		openNewest()
		if f == nil {
			continue
		}
		// читаем полные CSV-записи (может быть многострочный текст запроса)
		cr := csv.NewReader(reader)
		cr.FieldsPerRecord = -1
		cr.LazyQuotes = true
		for {
			rec, err := cr.Read()
			if err == io.EOF {
				break
			}
			if err != nil {
				// незавершённая запись в конце файла — ждём дозаписи
				break
			}
			ev, ok := parseRecord(rec)
			if !ok {
				continue
			}
			captured++
			pushEvent(cfg, rc, ev)
			updateAgg(cfg, rc, ev)
			rc.do("HSET", cfg.metaKey, "last_ts", ev.TS, "stack_len", strconv.Itoa(cfg.maxStack))
			rc.do("HINCRBY", cfg.metaKey, "captured", "1")
			_ = captured
		}
		// запомним позицию: csv.Reader буферизует, поэтому обновим offset по факту
		if st, err := f.Stat(); err == nil {
			offset = st.Size()
		}
		trimAgg(cfg, rc)
	}
}

// newestCSV возвращает путь к самому свежему *.csv в каталоге.
func newestCSV(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	var best string
	var bestT time.Time
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".csv") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().After(bestT) {
			bestT = info.ModTime()
			best = filepath.Join(dir, e.Name())
		}
	}
	return best
}

// message вида: "duration: 12.345 ms  statement: SELECT ..."
// или "duration: 12.345 ms  execute <unnamed>: SELECT ..."
var reDuration = regexp.MustCompile(`(?s)duration:\s*([0-9.]+)\s*ms\s+(?:statement|execute[^:]*|parse[^:]*|bind[^:]*):\s*(.*)`)

// parseRecord извлекает из CSV-записи PostgreSQL событие запроса.
// Колонки csvlog PG15: 0=log_time 1=user 2=db ... 13=message ...
func parseRecord(rec []string) (queryEvent, bool) {
	if len(rec) < 14 {
		return queryEvent{}, false
	}
	msg := rec[13]
	m := reDuration.FindStringSubmatch(msg)
	if m == nil {
		return queryEvent{}, false
	}
	dur, _ := strconv.ParseFloat(m[1], 64)
	q := strings.TrimSpace(m[2])
	if q == "" {
		return queryEvent{}, false
	}
	return queryEvent{
		TS:    rec[0],
		User:  rec[1],
		DB:    rec[2],
		DurMs: dur,
		Query: q,
	}, true
}

func pushEvent(cfg config, rc *redisClient, ev queryEvent) {
	b, _ := json.Marshal(ev)
	rc.do("LPUSH", cfg.stackKey, string(b))
	rc.do("LTRIM", cfg.stackKey, "0", strconv.Itoa(cfg.maxStack-1))
}

// нормализация: убираем конкретные значения, чтобы группировать запросы.
var (
	reNum   = regexp.MustCompile(`\b\d+\b`)
	reStr   = regexp.MustCompile(`'[^']*'`)
	reWS    = regexp.MustCompile(`\s+`)
	reInVal = regexp.MustCompile(`(?i)\bin\s*\([^)]*\)`)
)

func normalize(q string) string {
	s := q
	s = reStr.ReplaceAllString(s, "?")
	s = reInVal.ReplaceAllString(s, "in (?)")
	s = reNum.ReplaceAllString(s, "?")
	s = reWS.ReplaceAllString(s, " ")
	s = strings.TrimSpace(s)
	if len(s) > 512 {
		s = s[:512]
	}
	return s
}

func updateAgg(cfg config, rc *redisClient, ev queryEvent) {
	norm := normalize(ev.Query)
	rc.do("ZINCRBY", cfg.aggKey, "1", norm)
	// метаданные агрегата: читаем-обновляем-пишем (гонки некритичны для трассировки)
	var mv aggMetaVal
	if raw, ok := rc.getHash(cfg.aggMeta, norm); ok {
		_ = json.Unmarshal([]byte(raw), &mv)
	}
	mv.Norm = norm
	mv.Calls++
	mv.TotalMs += ev.DurMs
	if ev.DurMs > mv.MaxMs {
		mv.MaxMs = ev.DurMs
	}
	mv.LastTS = ev.TS
	if mv.Sample == "" {
		mv.Sample = ev.Query
	}
	b, _ := json.Marshal(mv)
	rc.do("HSET", cfg.aggMeta, norm, string(b))
}

// trimAgg держит в агрегации только top-N по числу вызовов.
func trimAgg(cfg config, rc *redisClient) {
	n, ok := rc.zcard(cfg.aggKey)
	if !ok || n <= int64(cfg.aggTop) {
		return
	}
	// удалить наименее частые (ранги 0 .. n-aggTop-1)
	rc.do("ZREMRANGEBYRANK", cfg.aggKey, "0", strconv.FormatInt(n-int64(cfg.aggTop)-1, 10))
}
