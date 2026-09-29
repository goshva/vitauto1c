package main

import (
	"bufio"
	"fmt"
	"log"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Минимальный RESP-клиент Redis на стандартной библиотеке.
// Автоматически переподключается; при недоступности Redis команды
// молча пропускаются (трассировка не должна валить процесс).
type redisClient struct {
	addr string
	mu   sync.Mutex
	conn net.Conn
	rw   *bufio.ReadWriter
}

func newRedis(addr string) *redisClient {
	rc := &redisClient{addr: addr}
	rc.connect()
	return rc
}

func (r *redisClient) connect() {
	c, err := net.DialTimeout("tcp", r.addr, 3*time.Second)
	if err != nil {
		r.conn = nil
		r.rw = nil
		return
	}
	r.conn = c
	r.rw = bufio.NewReadWriter(bufio.NewReader(c), bufio.NewWriter(c))
}

// do отправляет команду и вычитывает (и отбрасывает) ответ.
// Возвращает сырую первую строку ответа и признак успеха.
func (r *redisClient) do(args ...string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.doLocked(args...)
}

func (r *redisClient) doLocked(args ...string) (string, bool) {
	for attempt := 0; attempt < 2; attempt++ {
		if r.rw == nil {
			r.connect()
			if r.rw == nil {
				return "", false
			}
		}
		if err := r.writeCmd(args...); err != nil {
			r.reset()
			continue
		}
		line, err := r.readReply()
		if err != nil {
			r.reset()
			continue
		}
		return line, true
	}
	return "", false
}

func (r *redisClient) writeCmd(args ...string) error {
	var b strings.Builder
	b.WriteString("*")
	b.WriteString(strconv.Itoa(len(args)))
	b.WriteString("\r\n")
	for _, a := range args {
		b.WriteString("$")
		b.WriteString(strconv.Itoa(len(a)))
		b.WriteString("\r\n")
		b.WriteString(a)
		b.WriteString("\r\n")
	}
	if _, err := r.rw.WriteString(b.String()); err != nil {
		return err
	}
	return r.rw.Flush()
}

// readReply читает один ответ RESP и возвращает его как строку.
// Поддерживает +simple, -err, :int, $bulk, *array (массив вычитывается целиком,
// возвращается количество элементов как строка).
func (r *redisClient) readReply() (string, error) {
	line, err := r.rw.ReadString('\n')
	if err != nil {
		return "", err
	}
	line = strings.TrimRight(line, "\r\n")
	if line == "" {
		return "", fmt.Errorf("пустой ответ")
	}
	switch line[0] {
	case '+', '-', ':':
		return line[1:], nil
	case '$':
		n, _ := strconv.Atoi(line[1:])
		if n < 0 {
			return "", nil // nil bulk
		}
		buf := make([]byte, n+2) // +CRLF
		if _, err := readFull(r.rw, buf); err != nil {
			return "", err
		}
		return string(buf[:n]), nil
	case '*':
		n, _ := strconv.Atoi(line[1:])
		for i := 0; i < n; i++ {
			if _, err := r.readReply(); err != nil {
				return "", err
			}
		}
		return strconv.Itoa(n), nil
	}
	return line, nil
}

func readFull(rw *bufio.ReadWriter, buf []byte) (int, error) {
	got := 0
	for got < len(buf) {
		n, err := rw.Read(buf[got:])
		got += n
		if err != nil {
			return got, err
		}
	}
	return got, nil
}

func (r *redisClient) reset() {
	if r.conn != nil {
		r.conn.Close()
	}
	r.conn = nil
	r.rw = nil
}

// getHash возвращает значение поля хэша (HGET).
func (r *redisClient) getHash(key, field string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.rw == nil {
		r.connect()
		if r.rw == nil {
			return "", false
		}
	}
	if err := r.writeCmd("HGET", key, field); err != nil {
		r.reset()
		return "", false
	}
	v, err := r.readReply()
	if err != nil {
		r.reset()
		return "", false
	}
	if v == "" {
		return "", false
	}
	return v, true
}

// zcard возвращает число элементов sorted set.
func (r *redisClient) zcard(key string) (int64, bool) {
	v, ok := r.do("ZCARD", key)
	if !ok {
		return 0, false
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

func init() { _ = log.Println }
