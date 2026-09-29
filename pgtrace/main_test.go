package main

import (
	"bufio"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// mockRedis — минимальный сервер RESP, пишущий команды в лог и отвечающий разумно.
type mockRedis struct {
	ln   net.Listener
	mu   sync.Mutex
	cmds [][]string
	hset map[string]map[string]string // key -> field -> value
	zset map[string]map[string]float64 // key -> member -> score
	list map[string][]string
}

func newMock(t *testing.T) *mockRedis {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	m := &mockRedis{ln: ln, hset: map[string]map[string]string{}, zset: map[string]map[string]float64{}, list: map[string][]string{}}
	go m.serve()
	return m
}

func (m *mockRedis) addr() string { return m.ln.Addr().String() }

func (m *mockRedis) serve() {
	for {
		c, err := m.ln.Accept()
		if err != nil {
			return
		}
		go m.handle(c)
	}
}

func (m *mockRedis) handle(c net.Conn) {
	r := bufio.NewReader(c)
	for {
		args, err := readCmd(r)
		if err != nil {
			return
		}
		if len(args) == 0 {
			continue
		}
		m.mu.Lock()
		m.cmds = append(m.cmds, args)
		reply := m.apply(args)
		m.mu.Unlock()
		c.Write([]byte(reply))
	}
}

func (m *mockRedis) apply(args []string) string {
	switch strings.ToUpper(args[0]) {
	case "HSET":
		key := args[1]
		if m.hset[key] == nil {
			m.hset[key] = map[string]string{}
		}
		for i := 2; i+1 < len(args); i += 2 {
			m.hset[key][args[i]] = args[i+1]
		}
		return ":1\r\n"
	case "HGET":
		if v, ok := m.hset[args[1]][args[2]]; ok {
			return "$" + strconv.Itoa(len(v)) + "\r\n" + v + "\r\n"
		}
		return "$-1\r\n"
	case "HINCRBY":
		key := args[1]
		if m.hset[key] == nil {
			m.hset[key] = map[string]string{}
		}
		cur, _ := strconv.Atoi(m.hset[key][args[2]])
		inc, _ := strconv.Atoi(args[3])
		cur += inc
		m.hset[key][args[2]] = strconv.Itoa(cur)
		return ":" + strconv.Itoa(cur) + "\r\n"
	case "LPUSH":
		m.list[args[1]] = append([]string{args[2]}, m.list[args[1]]...)
		return ":" + strconv.Itoa(len(m.list[args[1]])) + "\r\n"
	case "LTRIM":
		return "+OK\r\n"
	case "ZINCRBY":
		key := args[1]
		if m.zset[key] == nil {
			m.zset[key] = map[string]float64{}
		}
		inc, _ := strconv.ParseFloat(args[2], 64)
		m.zset[key][args[3]] += inc
		return "+1\r\n"
	case "ZCARD":
		return ":" + strconv.Itoa(len(m.zset[args[1]])) + "\r\n"
	case "ZREMRANGEBYRANK":
		return ":0\r\n"
	}
	return "+OK\r\n"
}

func readCmd(r *bufio.Reader) ([]string, error) {
	line, err := r.ReadString('\n')
	if err != nil {
		return nil, err
	}
	line = strings.TrimRight(line, "\r\n")
	if len(line) == 0 || line[0] != '*' {
		return nil, nil
	}
	n, _ := strconv.Atoi(line[1:])
	args := make([]string, 0, n)
	for i := 0; i < n; i++ {
		hdr, err := r.ReadString('\n') // $len
		if err != nil {
			return nil, err
		}
		ln, _ := strconv.Atoi(strings.TrimRight(hdr[1:], "\r\n"))
		buf := make([]byte, ln+2)
		got := 0
		for got < len(buf) {
			k, err := r.Read(buf[got:])
			got += k
			if err != nil {
				return nil, err
			}
		}
		args = append(args, string(buf[:ln]))
	}
	return args, nil
}

func (m *mockRedis) count(cmd string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, c := range m.cmds {
		if strings.EqualFold(c[0], cmd) {
			n++
		}
	}
	return n
}

// Пишем несколько CSV-строк как их формирует PostgreSQL csvlog, и проверяем,
// что коллектор распарсил запросы и отправил в Redis нужные команды.
func TestEndToEnd(t *testing.T) {
	dir := t.TempDir()
	csvPath := filepath.Join(dir, "postgresql-01.csv")
	// 26 колонок PG15; заполняем только значимые (0 время,1 user,2 db,13 message)
	rows := []string{
		`2026-09-29 12:00:00.111 MSK,"postgres","autoservice",100,"127.0.0.1:5000","s1",1,"SELECT",,,,LOG,00000,"duration: 12.500 ms  statement: SELECT * FROM t WHERE id = 42",,,,,,,,,"app","client backend",,0`,
		`2026-09-29 12:00:00.222 MSK,"postgres","autoservice",100,"127.0.0.1:5000","s1",2,"SELECT",,,,LOG,00000,"duration: 3.100 ms  statement: SELECT * FROM t WHERE id = 77",,,,,,,,,"app","client backend",,0`,
		`2026-09-29 12:00:00.333 MSK,"postgres","autoservice",100,"127.0.0.1:5000","s1",3,"LOG",,,,LOG,00000,"connection received: host=127.0.0.1",,,,,,,,,"app","client backend",,0`,
	}
	if err := os.WriteFile(csvPath, []byte(strings.Join(rows, "\n")+"\n"), 0644); err != nil {
		t.Fatal(err)
	}

	m := newMock(t)
	cfg := config{
		redisAddr: m.addr(), logDir: dir, maxStack: 1000, aggTop: 500,
		stackKey: "pg:trace", aggKey: "pg:agg", aggMeta: "pg:agg:meta", metaKey: "pg:meta",
		pollEvery: 50 * time.Millisecond,
	}
	rc := newRedis(cfg.redisAddr)
	stop := make(chan struct{})
	go run(cfg, rc, "start", stop)
	time.Sleep(400 * time.Millisecond)
	close(stop)
	time.Sleep(100 * time.Millisecond)

	// Два запроса с id=42 и id=77 нормализуются в один вид -> LPUSH дважды, агрегат один
	if got := m.count("LPUSH"); got != 2 {
		t.Fatalf("LPUSH ожидалось 2, получено %d", got)
	}
	m.mu.Lock()
	stack := m.list["pg:trace"]
	agg := m.zset["pg:agg"]
	m.mu.Unlock()
	if len(stack) != 2 {
		t.Fatalf("в стеке ожидалось 2 записи, получено %d", len(stack))
	}
	if !strings.Contains(stack[0], `"dur_ms":3.1`) {
		t.Fatalf("верхняя запись стека без длительности: %s", stack[0])
	}
	// нормализованный ключ должен быть один с score 2
	if len(agg) != 1 {
		t.Fatalf("в агрегации ожидался 1 нормализованный запрос, получено %d: %v", len(agg), agg)
	}
	for k, v := range agg {
		if v != 2 {
			t.Fatalf("score агрегата ожидался 2, получено %v (%s)", v, k)
		}
		if !strings.Contains(k, "id = ?") {
			t.Fatalf("нормализация не сработала: %q", k)
		}
	}
}

func TestNormalize(t *testing.T) {
	cases := map[string]string{
		"SELECT * FROM t WHERE id = 42":            "SELECT * FROM t WHERE id = ?",
		"SELECT * FROM t WHERE name = 'Вася'":      "SELECT * FROM t WHERE name = ?",
		"DELETE FROM x WHERE id IN (1, 2, 3)":      "DELETE FROM x WHERE id in (?)",
	}
	for in, want := range cases {
		if got := normalize(in); got != want {
			t.Errorf("normalize(%q) = %q, ожидалось %q", in, got, want)
		}
	}
}
