// Package auth — вход и сессии vitauto-api (контекст access, ТР-Д10, ТР-Н3): логин — наименование пользователя
// (как вход PWA в 1С), пароль bcrypt, Bearer-токен сессии, роль АРМ из arm.user_role.
package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"vitauto/backend/internal/arm"
)

// SessionTTL — срок действия сессии.
const SessionTTL = 12 * time.Hour

type Service struct{ DB *pgxpool.Pool }

// Session — ответ POST /session и GET /session.
type Session struct {
	Token    string `json:"token"`
	UserName string `json:"userName"`
	Login    string `json:"login"`
	Role     string `json:"role"`
	Screen   string `json:"screen"`
	UserRef  string `json:"userRef"`
}

func screen(role string) string {
	if role == "supply" {
		return "supply"
	}
	return "sales"
}

// Login — проверка пароля и новая сессия.
func (s *Service) Login(ctx context.Context, login, password string) (*Session, error) {
	if login == "" {
		return nil, &arm.Problem{Status: 400, Code: "bad_request", Message: "login: имя пользователя", Field: "login"}
	}
	var userID uuid.UUID
	var hash *string
	var name string
	err := s.DB.QueryRow(ctx, `select c.user_id, c.password_hash, u.name from auth.credential c join auth."user" u on u.id = c.user_id
		where c.login = $1 and not u.deleted and not coalesce(u.inactive, false)`, login).Scan(&userID, &hash, &name)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (hash == nil || bcrypt.CompareHashAndPassword([]byte(*hash), []byte(password)) != nil)) {
		return nil, &arm.Problem{Status: 401, Code: "unauthorized", Message: "Неверное имя пользователя или пароль"}
	}
	if err != nil {
		return nil, err
	}
	var roleEnum string
	if err := s.DB.QueryRow(ctx, "select role from arm.user_role where user_id = $1 limit 1", userID).Scan(&roleEnum); err != nil || arm.RoleByEnum[roleEnum] == "" {
		return nil, &arm.Problem{Status: 403, Code: "matrix_denied", Message: "У пользователя «" + login + "» нет роли АРМ (Права пользователей АРМ)"}
	}
	role := arm.RoleByEnum[roleEnum]
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	token := hex.EncodeToString(b)
	if _, err := s.DB.Exec(ctx, "insert into auth.session (token, user_id, login, role, expires_at) values ($1, $2, $3, $4, $5)",
		token, userID, login, role, time.Now().Add(SessionTTL)); err != nil {
		return nil, err
	}
	return &Session{Token: token, UserName: name, Login: login, Role: role, Screen: screen(role), UserRef: userID.String()}, nil
}

// Resolve — пользователь по токену; роль — текущая из arm.user_role (смена роли действует сразу).
func (s *Service) Resolve(ctx context.Context, token string) (*Session, arm.Actor, error) {
	var userID uuid.UUID
	var login, name string
	var roleEnum *string
	err := s.DB.QueryRow(ctx, `select s.user_id, s.login, u.name, (select role from arm.user_role r where r.user_id = s.user_id limit 1)
		from auth.session s join auth."user" u on u.id = s.user_id
		where s.token = $1 and not s.revoked and s.expires_at > now() and not coalesce(u.inactive, false)`, token).Scan(&userID, &login, &name, &roleEnum)
	if err != nil {
		return nil, arm.Actor{}, &arm.Problem{Status: 401, Code: "unauthorized", Message: "Нет сессии"}
	}
	role := ""
	if roleEnum != nil {
		role = arm.RoleByEnum[*roleEnum]
	}
	if role == "" {
		return nil, arm.Actor{}, &arm.Problem{Status: 403, Code: "matrix_denied", Message: "У пользователя нет роли АРМ"}
	}
	return &Session{Token: token, UserName: name, Login: login, Role: role, Screen: screen(role), UserRef: userID.String()},
		arm.Actor{UserID: userID, UserName: name, Login: login, Role: role}, nil
}

// Logout — DELETE /session.
func (s *Service) Logout(ctx context.Context, token string) error {
	_, err := s.DB.Exec(ctx, "update auth.session set revoked = true where token = $1", token)
	return err
}

// Hash — bcrypt пароля.
func Hash(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(b), err
}
