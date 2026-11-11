package arm

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
)

// Настройки прав групп пользователей: роль = группа. Одна запись — матрица полей,
// процессы и узлы, где группа работает, и CRUD справочников/каталога.
// Источник данных — те же каноны, что у PWA: matrix.json и process-presets.json
// (matrix.json собирается из index.html/default-matrix.js, process-presets.json — из process.html).

//go:embed process-presets.json
var processPresetsJSON []byte

// UserGroupProcess — узел процесса, доступный группе.
type UserGroupProcess struct {
	ID       string   `json:"id"`
	Role     string   `json:"role"`
	RoleTitle string  `json:"roleTitle"`
	Title    string   `json:"title"`
	Statuses []string `json:"statuses"`
	Columns  []string `json:"columns"`
}

type userGroupProcesses struct {
	Source  string              `json:"source"`
	Groups  map[string][]string `json:"groups"`
	Context []string            `json:"context"`
	Nodes   []UserGroupProcess  `json:"nodes"`
}

var processPresets = func() userGroupProcesses {
	var p userGroupProcesses
	if err := json.Unmarshal(processPresetsJSON, &p); err != nil {
		panic(err)
	}
	return p
}()

// UserGroupCRUD — CRUD-права группы на справочник или каталог.
type UserGroupCRUD struct {
	Entity     string   `json:"entity"`     // directories | catalog | brands
	Name       string   `json:"name"`       // справочник/раздел
	Title      string   `json:"title"`      // человекочитаемое имя
	Operations []string `json:"operations"` // read, create, update, delete, restore
}

// UserGroup — настройки прав одной группы пользователей.
type UserGroup struct {
	Role      string            `json:"role"`
	Title     string            `json:"title"`
	Matrix    []MatrixColumn    `json:"matrix"`
	Processes []UserGroupProcess `json:"processes"`
	CRUD      []UserGroupCRUD   `json:"crud"`
}

// UserGroupsResponse — GET /settings/groups.
type UserGroupsResponse struct {
	Source     string              `json:"source"`
	Statuses   []string            `json:"statuses"`
	Groups     []UserGroup         `json:"groups"`
	GroupsList []string            `json:"groupIds"`
	Columns    []MatrixColumn      `json:"columns"`
	Processes  []UserGroupProcess  `json:"processes"`
	CRUD       []UserGroupCRUD     `json:"crud"`
}

var roleTitles = map[string]string{
	"manager": "Менеджер", "storekeeper": "Кладовщик / Сборщик", "chief_mechanic": "Главный механик",
	"admin": "Администратор", "supplier": "Поставщик", "client": "Клиент", "supply": "Снабжение",
}

var dirTitles = map[string]string{
	"counterparties": "Контрагенты", "contracts": "Договоры", "service-types": "Виды услуг",
	"payment-forms": "Формы оплаты", "units": "Единицы", "warehouses": "Склады",
	"zones": "Зоны склада", "cells": "Ячейки",
}

// userGroupProcesses — узлы процесса группы (по role, как в process.html).
func processesForRole(role string) []UserGroupProcess {
	out := make([]UserGroupProcess, 0)
	for _, n := range processPresets.Nodes {
		if n.Role == role {
			out = append(out, n)
		}
	}
	return out
}

// CRUD-права групп: справочники — админ; каталог — по разделам; бренды — админ.
// Связь с процессами: узел A0 «НСИ: РРЦ / НМЦК / права» (админ) и A2 «Доводка НСИ».
func crudForRole(role string) []UserGroupCRUD {
	out := make([]UserGroupCRUD, 0)
	// Справочники раздела «Справочники» (directories.go): создание/изменение/удаление — только админ.
	if contains(directoryEditRoles, role) {
		for _, name := range dirNames() {
			title := dirTitles[name]
			if title == "" {
				title = name
			}
			out = append(out, UserGroupCRUD{Entity: "directories", Name: name, Title: title, Operations: []string{"read", "create", "update", "delete", "restore"}})
		}
	}
	// Каталог (catalog.go): разделы «Товары», «Услуги», «Машины».
	for kind, roles := range CatalogEdit {
		if !contains(roles, role) {
			continue
		}
		title := "Товары"
		switch kind {
		case "services":
			title = "Услуги"
		case "cars":
			title = "Машины"
		}
		out = append(out, UserGroupCRUD{Entity: "catalog", Name: kind, Title: title, Operations: []string{"read", "create", "update", "delete", "restore"}})
	}
	// Бренды (brands.go): меняет только админ; читают все авторизованные.
	if contains(brandEditRoles, role) {
		out = append(out, UserGroupCRUD{Entity: "brands", Name: "brands", Title: "Бренды", Operations: []string{"read", "create", "update", "delete", "restore"}})
	}
	return out
}

// UserGroups — настройки прав всех групп (GET /settings/groups).
func (s *Service) UserGroups(ctx context.Context) (UserGroupsResponse, error) {
	m, _ := matrixCurrent()
	roleIDs := make([]string, 0, len(m.Roles))
	for role := range m.Roles {
		roleIDs = append(roleIDs, role)
	}
	sort.Strings(roleIDs)

	resp := UserGroupsResponse{Source: "matrix.json + process-presets.json", Statuses: m.Statuses}
	resp.Columns = m.Roles["manager"]
	resp.Processes = processPresets.Nodes
	resp.GroupsList = roleIDs
	resp.Groups = make([]UserGroup, 0, len(roleIDs))
	for _, role := range roleIDs {
		g := UserGroup{
			Role:      role,
			Title:     roleTitles[role],
			Matrix:    m.Roles[role],
			Processes: processesForRole(role),
			CRUD:      crudForRole(role),
		}
		if g.Title == "" {
			g.Title = role
		}
		resp.Groups = append(resp.Groups, g)
	}
	resp.CRUD = allCRUD()
	return resp, nil
}

// allCRUD — полный список CRUD-сущностей (для фильтров и справки).
func allCRUD() []UserGroupCRUD {
	seen := map[string]bool{}
	out := make([]UserGroupCRUD, 0)
	for _, role := range []string{"admin", "manager", "storekeeper", "chief_mechanic"} {
		for _, c := range crudForRole(role) {
			key := c.Entity + "/" + c.Name
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, c)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Entity+"/"+out[i].Name < out[j].Entity+"/"+out[j].Name })
	return out
}

// UserGroupByRole — настройки одной группы (GET /settings/groups/{role}).
func (s *Service) UserGroupByRole(ctx context.Context, role string) (UserGroup, error) {
	m, _ := matrixCurrent()
	if _, ok := m.Roles[role]; !ok {
		return UserGroup{}, fail(404, "not_found", "Группа не найдена: "+role)
	}
	return UserGroup{
		Role:      role,
		Title:     roleTitles[role],
		Matrix:    m.Roles[role],
		Processes: processesForRole(role),
		CRUD:      crudForRole(role),
	}, nil
}

// UserGroupMatrix — матрица группы по статусам (GET /settings/groups/{role}/matrix).
func (s *Service) UserGroupMatrix(ctx context.Context, role string) (MatrixResponse, error) {
	m, _ := matrixCurrent()
	if _, ok := m.Roles[role]; !ok {
		return MatrixResponse{}, fail(404, "not_found", "Группа не найдена: "+role)
	}
	return MatrixFor(role), nil
}

// SaveGroupMatrix — запись матрицы группы (PUT /settings/groups/{role}/matrix).
func (s *Service) SaveGroupMatrix(ctx context.Context, role string, cols []MatrixColumn) error {
	return SaveMatrixRole(role, cols)
}

// UserGroupProcesses — процессы и узлы группы (GET /settings/groups/{role}/processes).
func (s *Service) UserGroupProcesses(ctx context.Context, role string) ([]UserGroupProcess, error) {
	m, _ := matrixCurrent()
	if _, ok := m.Roles[role]; !ok {
		return nil, fail(404, "not_found", "Группа не найдена: "+role)
	}
	return processesForRole(role), nil
}

// UserGroupCRUDList — CRUD-права группы (GET /settings/groups/{role}/crud).
func (s *Service) UserGroupCRUDList(ctx context.Context, role string) ([]UserGroupCRUD, error) {
	m, _ := matrixCurrent()
	if _, ok := m.Roles[role]; !ok {
		return nil, fail(404, "not_found", "Группа не найдена: "+role)
	}
	return crudForRole(role), nil
}

// normalizeRole — роль из пути/запроса; неизвестная роль — как в MatrixFor, менеджер.
func normalizeRole(role string) string {
	m, _ := matrixCurrent()
	if _, ok := m.Roles[role]; ok {
		return role
	}
	return "manager"
}

// String — для отладочных сообщений.
func (g UserGroup) String() string {
	return fmt.Sprintf("%s (%s): %d колонок, %d узлов, %d CRUD",
		g.Role, g.Title, len(g.Matrix), len(g.Processes), len(g.CRUD))
}
