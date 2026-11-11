// vitauto-desktop — единое приложение демо-стенда vitauto: Go API + собранная PWA
// на одном порту и отдельное окно приложения (Chrome/Edge --app).
//
// Сборка: tools\build-seed-app.ps1 (кладет pwa\dist в webroot и собирает bin\VITAUTO.exe).
//
//	VITAUTO_APP_ADDR=127.0.0.1:18180
//	VITAUTO_DB=postgres://postgres:postgres@127.0.0.1:5434/vitauto_app
//	VITAUTO_PG_PORT=5434 VITAUTO_PG_DATA=D:\vitauto_app\pgdata
package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/jackc/pgx/v5/pgxpool"

	"vitauto/backend/internal/api"
	"vitauto/backend/internal/application"
	"vitauto/backend/internal/arm"
	"vitauto/backend/internal/auth"
	"vitauto/backend/internal/platform/ws"
)

//go:embed all:webroot
var webFS embed.FS

type config struct {
	addr     string
	dsn      string
	pgPort   string
	pgData   string
	pgBin    string
	appData  string
	logFile  string
	openMode string // app | browser
}

func main() {
	cfg := loadConfig()

	logger, closeLog := setupLog(cfg.logFile)
	defer closeLog()
	log.SetOutput(logger)
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	initLogLevel()

	log.Printf("=== VITAUTO демо-стенд ===")
	log.Printf("адрес: %s, база: %s", cfg.addr, redactDSN(cfg.dsn))
	logDebugf("уровень логирования: %s", levelName())
	logDebugf("данные приложения: %s, каталог PostgreSQL: %s, порт %s", cfg.appData, cfg.pgData, cfg.pgPort)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	url := "http://" + cfg.addr + "/"

	// Экземпляр уже слушает порт. Сначала поднимаем PostgreSQL: прошлый процесс мог
	// остаться «живым», но неработоспособным из-за остановленной базы. Без этого шага
	// повторный запуск просто открывал окно поверх сломанного стенда.
	if isListening(cfg.addr) {
		log.Printf("сервер уже слушает %s", cfg.addr)
		if err := ensurePostgres(cfg); err != nil {
			log.Printf("PostgreSQL: %v", err)
		}

		health := probeHealth(cfg.addr, 5*time.Second)
		logDebugf("health существующего экземпляра: %s", health)
		if health.OK {
			log.Printf("стенд работает — открываю окно")
			if err := openWindow(cfg, url, make(chan struct{})); err != nil {
				fatalBox("Не удалось открыть окно приложения:\n"+err.Error(), 1)
			}
			return
		}

		msg := "Стенд уже запущен, но не работает (" + health.String() + ").\n\n" +
			"Остановите его и запустите заново:\n" +
			"  tools\\stand.ps1 -Action restart"
		log.Printf("неработоспособный экземпляр: %s", health)
		fatalBox(msg, 2)
	}

	if err := ensurePostgres(cfg); err != nil {
		log.Printf("PostgreSQL: %v", err)
		fatalBox("Не удалось запустить PostgreSQL на порту "+cfg.pgPort+":\n"+err.Error(), 1)
	}

	pool, err := waitPool(ctx, cfg.dsn, 30*time.Second)
	if err != nil {
		log.Printf("база: %v", err)
		fatalBox("База данных vitauto_app недоступна:\n"+err.Error()+
			"\n\nПроверьте, что PostgreSQL запущен на порту "+cfg.pgPort+
			" и база создана (tools\\seed-stand.ps1).", 1)
	}
	defer pool.Close()

	hub := ws.NewHub()
	go ws.NewListener(cfg.dsn, hub).Run(ctx)

	app := &api.App{
		ARM:  &arm.Service{DB: pool},
		Auth: &auth.Service{DB: pool},
		Apps: &application.Service{DB: pool},
		WS:   hub,
	}

	handler := withRequestLog(newHandler(api.NewMux(pool, app)))
	srv := &http.Server{Addr: cfg.addr, Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		log.Printf("слушаю %s", cfg.addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("сервер: %v", err)
			fatalBox("Не удалось запустить сервер на "+cfg.addr+":\n"+err.Error(), 1)
		}
	}()

	// Ждём, пока сервер поднимется, чтобы окно не открылось на пустой порт.
	if !waitListening(cfg.addr, 10*time.Second) {
		fatalBox("Сервер не поднялся на "+cfg.addr, 1)
	}

	done := make(chan struct{})
	if err := openWindow(cfg, url, done); err != nil {
		log.Printf("окно: %v", err)
		fatalBox("Не удалось открыть окно приложения:\n"+err.Error(), 1)
	} else {
		log.Printf("окно приложения открыто: %s", url)
	}

	select {
	case <-ctx.Done():
	case <-done:
	}
	shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
	log.Printf("остановлено")
}

func loadConfig() config {
	appData := os.Getenv("VITAUTO_DATA")
	if appData == "" {
		appData = filepath.Join(os.Getenv("LOCALAPPDATA"), "VITAUTO")
	}
	if os.Getenv("LOCALAPPDATA") == "" && os.Getenv("VITAUTO_DATA") == "" {
		home, _ := os.UserHomeDir()
		appData = filepath.Join(home, ".vitauto")
	}
	port := env("VITAUTO_PG_PORT", "5434")
	addr := env("VITAUTO_APP_ADDR", "127.0.0.1:18180")
	// Основной стенд пишет в app.log; экземпляр на другом порту (отладка, второй
	// стенд) — в свой файл, иначе два процесса делят один лог.
	logName := "app.log"
	if addr != "127.0.0.1:18180" {
		suffix := strings.NewReplacer(":", "-", ".", "-").Replace(addr)
		logName = "app-" + suffix + ".log"
	}
	return config{
		addr:     addr,
		dsn:      env("VITAUTO_DB", "postgres://postgres:postgres@127.0.0.1:"+port+"/vitauto_app"),
		pgPort:   port,
		pgData:   env("VITAUTO_PG_DATA", `D:\vitauto_app\pgdata`),
		pgBin:    env("VITAUTO_PG_BIN", `C:\Program Files\PostgreSQL 1C\18\bin`),
		appData:  appData,
		logFile:  filepath.Join(appData, "logs", logName),
		openMode: env("VITAUTO_OPEN", "app"),
	}
}

func setupLog(path string) (io.Writer, func()) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "лог: не удалось создать каталог %s: %v — пишу только в поток ошибок\n", filepath.Dir(path), err)
		return os.Stderr, func() {}
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "лог: не удалось открыть %s: %v — пишу только в поток ошибок\n", path, err)
		return os.Stderr, func() {}
	}
	return io.MultiWriter(f, os.Stderr), func() { _ = f.Close() }
}

func redactDSN(dsn string) string {
	if i := strings.Index(dsn, "@"); i > 0 {
		if j := strings.Index(dsn, "://"); j >= 0 {
			return dsn[:j+3] + "***" + dsn[i:]
		}
	}
	return dsn
}

// withRequestLog пишет каждый HTTP-запрос при VITAUTO_LOG_LEVEL=debug или trace.
// Для отладки PWA это основной источник понимания, что именно вызвал экран.
func withRequestLog(next http.Handler) http.Handler {
	if logLevel > levelDebug {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		path := r.URL.Path
		if r.URL.RawQuery != "" {
			path += "?" + r.URL.RawQuery
		}
		log.Printf("[http] %s %s -> %d (%s)", r.Method, path, rec.status, time.Since(started).Round(time.Millisecond))
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// newHandler: /api/* — REST/WebSocket, остальное — собранная PWA с fallback на index.html.
func newHandler(api http.Handler) http.Handler {
	sub, err := fs.Sub(webFS, "webroot")
	if err != nil {
		log.Fatalf("webroot: %v", err)
	}
	files := http.FileServer(http.FS(sub))
	root := http.NewServeMux()
	root.Handle("/api/", api)
	root.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" || !strings.Contains(filepath.Base(p), ".") {
			serveIndex(w, r, sub)
			return
		}
		if strings.HasSuffix(p, ".webmanifest") {
			w.Header().Set("Content-Type", "application/manifest+json")
		}
		if strings.HasSuffix(p, ".js") || strings.HasSuffix(p, ".webmanifest") || strings.HasSuffix(p, ".html") {
			w.Header().Set("Cache-Control", "no-cache")
		} else if strings.HasPrefix(p, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		files.ServeHTTP(w, r)
	}))
	return root
}

func serveIndex(w http.ResponseWriter, r *http.Request, sub fs.FS) {
	b, err := fs.ReadFile(sub, "index.html")
	if err != nil {
		http.Error(w, "PWA не собрана: webroot/index.html отсутствует (tools\\build-seed-app.ps1)", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(b)
}

// ensurePostgres проверяет порт и, если нужно, поднимает кластер через pg_ctl.
func ensurePostgres(cfg config) error {
	if isListening("127.0.0.1:" + cfg.pgPort) {
		return nil
	}
	pgCtl := filepath.Join(cfg.pgBin, "pg_ctl.exe")
	if _, err := os.Stat(pgCtl); err != nil {
		return fmt.Errorf("pg_ctl не найден: %s", pgCtl)
	}
	if _, err := os.Stat(cfg.pgData); err != nil {
		return fmt.Errorf("каталог данных не найден: %s", cfg.pgData)
	}
	logDir := filepath.Join(cfg.appData, "logs")
	_ = os.MkdirAll(logDir, 0o755)
	pgLog := filepath.Join(logDir, "postgres.log")
	log.Printf("PostgreSQL не отвечает на %s — запуск pg_ctl -D %s", cfg.pgPort, cfg.pgData)
	cmd := exec.Command(pgCtl, "start", "-D", cfg.pgData, "-l", pgLog, "-w", "-t", "60")
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%v (см. %s)", err, pgLog)
	}
	if !waitListening("127.0.0.1:"+cfg.pgPort, 15*time.Second) {
		return fmt.Errorf("порт %s не открылся", cfg.pgPort)
	}
	return nil
}

func waitPool(ctx context.Context, dsn string, timeout time.Duration) (*pgxpool.Pool, error) {
	deadline := time.Now().Add(timeout)
	var last error
	for {
		pool, err := pgxpool.New(ctx, dsn)
		if err == nil {
			pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
			err = pool.Ping(pingCtx)
			cancel()
			if err == nil {
				return pool, nil
			}
			pool.Close()
		}
		last = err
		if time.Now().After(deadline) {
			return nil, last
		}
		time.Sleep(1 * time.Second)
	}
}

func isListening(addr string) bool {
	c, err := net.DialTimeout("tcp", addr, 700*time.Millisecond)
	if err != nil {
		return false
	}
	_ = c.Close()
	return true
}

func waitListening(addr string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if isListening(addr) {
			return true
		}
		time.Sleep(200 * time.Millisecond)
	}
	return false
}

// openWindow открывает PWA в отдельном окне Chrome/Edge (режим приложения).
// Профиль по умолчанию — системный: если Chrome уже запущен, окно открывается в нём,
// а процесс-лаунчер сразу завершается. Тогда сервер продолжает работать (см. done).
func openWindow(cfg config, url string, done chan<- struct{}) error {
	browser, err := findBrowser()
	if err != nil {
		return err
	}
	args := []string{
		"--app=" + url,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-features=Translate",
		"--window-size=1500,950",
	}
	if profile := os.Getenv("VITAUTO_BROWSER_PROFILE"); profile != "" {
		_ = os.MkdirAll(profile, 0o755)
		args = append(args, "--user-data-dir="+profile)
	}
	if cfg.openMode == "browser" {
		args = []string{url}
	}
	log.Printf("браузер: %s %s", browser, strings.Join(args, " "))
	cmd := exec.Command(browser, args...)
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	started := time.Now()
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() {
		_ = cmd.Wait()
		if time.Since(started) < 2*time.Second {
			// Окно передано уже работающему Chrome — сервер оставляем запущенным.
			log.Printf("окно открыто в работающем браузере — сервер продолжает работать")
			return
		}
		log.Printf("окно закрыто — завершаю работу")
		close(done)
	}()
	return nil
}

func findBrowser() (string, error) {
	candidates := []string{
		filepath.Join(os.Getenv("ProgramFiles"), `Google\Chrome\Application\chrome.exe`),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), `Google\Chrome\Application\chrome.exe`),
		filepath.Join(os.Getenv("LOCALAPPDATA"), `Google\Chrome\Application\chrome.exe`),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(os.Getenv("ProgramFiles"), `Microsoft\Edge\Application\msedge.exe`),
	}
	for _, c := range candidates {
		if c == "" {
			continue
		}
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c, nil
		}
	}
	return "", errors.New("Chrome/Edge не найден (нужен для окна приложения)")
}

// fatalBox показывает ошибку и в логе, и окном (если запуск не через скрипт), затем выходит.
// Коды: 1 — общий сбой запуска, 2 — порт занят неработоспособным экземпляром.
func fatalBox(msg string, code int) {
	log.Printf("ОШИБКА: %s", msg)
	if os.Getenv("VITAUTO_NO_UI") == "" {
		user32 := syscall.NewLazyDLL("user32.dll")
		proc := user32.NewProc("MessageBoxW")
		text, _ := syscall.UTF16PtrFromString(msg)
		caption, _ := syscall.UTF16PtrFromString("VITAUTO — демо-стенд")
		_, _, _ = proc.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(caption)), 0x10)
	}
	os.Exit(code)
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// ── Уровни логирования ──────────────────────────────────────────────────────
// VITAUTO_LOG_LEVEL=trace|debug|info (по умолчанию info). debug добавляет решения
// запуска и каждый HTTP-запрос, trace — всё то же плюс мелочи вроде готовности портов.
const (
	levelTrace = 0
	levelDebug = 1
	levelInfo  = 2
)

var logLevel = levelInfo

func initLogLevel() {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("VITAUTO_LOG_LEVEL"))) {
	case "trace":
		logLevel = levelTrace
	case "debug":
		logLevel = levelDebug
	case "warn", "error":
		logLevel = levelInfo + 1 // только проблемы
	default:
		logLevel = levelInfo
	}
}

func levelName() string {
	switch logLevel {
	case levelTrace:
		return "trace"
	case levelDebug:
		return "debug"
	case levelInfo:
		return "info"
	default:
		return "warn"
	}
}

func logDebugf(format string, args ...any) {
	if logLevel <= levelDebug {
		log.Printf("[debug] "+format, args...)
	}
}

func logTracef(format string, args ...any) {
	if logLevel <= levelTrace {
		log.Printf("[trace] "+format, args...)
	}
}

// ── Проверка работоспособности уже запущенного экземпляра ───────────────────
type healthState struct {
	Status   string
	Database string
	OK       bool
}

func (h healthState) String() string {
	db := h.Database
	if db == "" {
		db = "нет данных"
	}
	return "статус " + h.Status + ", база " + db
}

func probeHealth(addr string, timeout time.Duration) healthState {
	out := healthState{Status: "нет ответа"}
	client := &http.Client{Timeout: timeout}
	resp, err := client.Get("http://" + addr + "/api/v1/health")
	if err != nil {
		logDebugf("health: %v", err)
		return out
	}
	defer resp.Body.Close()
	var body struct {
		Status   string `json:"status"`
		Database string `json:"database"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		logDebugf("health: разбор ответа: %v", err)
		return out
	}
	out.Status = body.Status
	out.Database = body.Database
	out.OK = body.Status == "ok"
	return out
}
