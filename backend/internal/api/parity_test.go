package api

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"vitauto/backend/internal/version"
)

var (
	reMethod = regexp.MustCompile(`method === '([A-Z]+)'`)
	rePath   = regexp.MustCompile(`path === '(/[^']*)'`)
	reSegEq  = regexp.MustCompile(`seg\[(\d)\] === '([a-z-]+)'`)
	reLen    = regexp.MustCompile(`seg\.length === (\d)`)
	reOp     = regexp.MustCompile(`op === '([A-Z]+) (/[^']+)'`)
	reIncl   = regexp.MustCompile(`\]\.includes\(seg\[(\d)\]\)`)
	reCase   = regexp.MustCompile(`case '([a-z-]+)':`)
)

// Маршруты, которые PWA вызывает через OData-бэкенд (pwa/src/odata/backend.js, функция handle), — из исходного текста.
// Разбор повторяет устройство handle: вложенные блоки `if (seg[i] === 'x' …) {` образуют стек известных сегментов,
// строка с `return ok(…)` добавляет свои условия (метод, seg.length, seg[i] === '…'); неизвестный сегмент — параметр {}.
func pwaRoutes(t *testing.T) []string {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "pwa", "src", "odata", "backend.js"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(src)
	handle := text[strings.Index(text, "return async function handle"):]
	routes := map[string]bool{}

	type frame map[int]string
	var stack []frame
	for _, line := range strings.Split(handle, "\n") {
		l := strings.TrimSpace(line)
		if strings.HasPrefix(l, "if (") && strings.HasSuffix(l, "{") {
			if mm, p := reMethod.FindStringSubmatch(l), rePath.FindStringSubmatch(l); mm != nil && p != nil {
				routes[mm[1]+" "+p[1]] = true // if (method === 'GET' && path === '/matrix') { return … }
			}
			f := frame{}
			for _, s := range reSegEq.FindAllStringSubmatch(l, -1) {
				f[int(s[1][0]-'0')] = s[2]
			}
			if m := reIncl.FindStringSubmatch(l); m != nil {
				f[int(m[1][0]-'0')] = "{}" // ['goods','services','cars'].includes(seg[1])
			}
			stack = append(stack, f)
			continue
		}
		if l == "}" && len(stack) > 0 {
			stack = stack[:len(stack)-1]
			continue
		}
		if m := reOp.FindStringSubmatch(l); m != nil {
			routes[m[1]+" "+m[2]] = true
			continue
		}
		if strings.Contains(l, "key === 'POST /session'") {
			routes["POST /session"] = true
			continue
		}
		mm := reMethod.FindStringSubmatch(l)
		if mm == nil || !strings.Contains(l, "return") {
			continue
		}
		if p := rePath.FindStringSubmatch(l); p != nil {
			routes[mm[1]+" "+p[1]] = true
			continue
		}
		segs := map[int]string{}
		for _, f := range stack {
			for i, v := range f {
				segs[i] = v
			}
		}
		for _, s := range reSegEq.FindAllStringSubmatch(l, -1) {
			segs[int(s[1][0]-'0')] = s[2]
		}
		n := 0
		if lm := reLen.FindStringSubmatch(l); lm != nil {
			n = int(lm[1][0] - '0')
		}
		if strings.Contains(l, "&& id") || strings.Contains(l, "&& id)") { // каталог: элемент по seg[2]
			if n < 3 {
				n = 3
			}
		} else if strings.Contains(l, "!id") && n < 2 {
			n = 2
		}
		for i := range segs {
			if i+1 > n {
				n = i + 1
			}
		}
		if _, ok := segs[0]; !ok || n == 0 {
			continue
		}
		parts := make([]string, n)
		for i := 0; i < n; i++ {
			if v, ok := segs[i]; ok {
				parts[i] = v
			} else {
				parts[i] = "{}"
			}
		}
		routes[mm[1]+" /"+strings.Join(parts, "/")] = true
	}
	// операции-заглушки (501): ключи таблицы NOT_SUPPORTED
	if ns := strings.Index(text, "export const NOT_SUPPORTED"); ns >= 0 {
		block := text[ns : ns+strings.Index(text[ns:], "};")]
		for _, m := range regexp.MustCompile(`'([A-Z]+) (/[^']+)'`).FindAllStringSubmatch(block, -1) {
			routes[m[1]+" "+m[2]] = true
		}
	}
	// справочники: GET /directories/{name} — имена из switch функции directory
	if routes["GET /directories/{}"] {
		delete(routes, "GET /directories/{}")
		dir := text[strings.Index(text, "async function directory"):]
		dir = dir[:strings.Index(dir, "default:")]
		for _, m := range reCase.FindAllStringSubmatch(dir, -1) {
			routes["GET /directories/"+m[1]] = true
		}
	}
	out := make([]string, 0, len(routes))
	for r := range routes {
		out = append(out, r)
	}
	sort.Strings(out)
	return out
}

type spec struct {
	Info  struct{ Version string }
	Paths map[string]map[string]any
}

func loadSpec(t *testing.T) spec {
	var s spec
	if err := yaml.Unmarshal(openapiYAML, &s); err != nil {
		t.Fatal(err)
	}
	return s
}

var reParam = regexp.MustCompile(`\{[^}]+\}`)

func specRoutes(s spec) map[string]bool {
	out := map[string]bool{}
	for p, ops := range s.Paths {
		for m := range ops {
			if m == "parameters" {
				continue
			}
			out[strings.ToUpper(m)+" "+reParam.ReplaceAllString(p, "{}")] = true
		}
	}
	return out
}

// G1.3: каждый маршрут контракта PWA описан в api/openapi.yaml.
func TestRouteParity(t *testing.T) {
	pwa := pwaRoutes(t)
	if len(pwa) < 38 {
		t.Fatalf("разбор backend.js нашёл только %d маршрутов — изменилось устройство handle? %v", len(pwa), pwa)
	}
	have := specRoutes(loadSpec(t))
	for _, r := range pwa {
		if !have[r] {
			t.Errorf("маршрут PWA нет в api/openapi.yaml: %s", r)
		}
	}
	t.Logf("маршрутов PWA: %d, операций в спецификации: %d\n%s", len(pwa), len(have), strings.Join(pwa, "\n"))
}

func TestSpecVersion(t *testing.T) {
	if v := loadSpec(t).Info.Version; v != version.Version {
		t.Fatalf("info.version %s ≠ version.Version %s", v, version.Version)
	}
}
