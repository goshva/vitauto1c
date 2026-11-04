// Package domain содержит агрегаты, value objects и бизнес-правила витавто.
package domain

import (
	"fmt"
)

// ——— Value Objects ———

// CostSum — себестоимость строки.
type CostSum float64

// SaleSum — сумма продажи = normHours * salePrice или quantity * salePrice.
func SaleSum(normHours, salePrice float64) float64 {
	hours := normHours
	if hours <= 0 {
		hours = 1
	}
	return hours * salePrice
}

// ——— FSM: переходы процессов (Арм_API.ПереходыПроцессов) ———

// Transition — переход процесса.
type Transition struct {
	To     string   // код перехода: reserve, assembly, shipped …
	Status Status   // значение 1С: Резервирование, Комплектуется …
	From   []Status // допустимые предыдущие статусы
	Roles  []string // разрешённые роли
}

// Transitions — все допустимые переходы (copied from arm.Transitions).
var Transitions = []Transition{
	{To: "reserve", Status: StatusReserve, From: []Status{StatusDraft, StatusInWork}, Roles: []string{"manager", "admin"}},
	{To: "assembly", Status: StatusAssembly, From: []Status{StatusReserve, StatusToStock, StatusAcceptance}, Roles: []string{"manager", "admin"}},
	{To: "assembly", Status: StatusAssembly, From: []Status{StatusPrepared, StatusAssembled}, Roles: []string{"manager", "admin", "chief_mechanic"}},
	{To: "assembly", Status: StatusAssembly, From: []Status{StatusReturn}, Roles: []string{"manager", "admin"}},
	{To: "ready_to_ship", Status: StatusAssembled, From: []Status{StatusAssembly}, Roles: []string{"storekeeper", "manager", "admin"}},
	{To: "shipped", Status: StatusShipped, From: []Status{StatusPaid, StatusInTransit}, Roles: []string{"manager", "admin"}},
	{To: "acceptance", Status: StatusAcceptance, From: []Status{StatusShipped}, Roles: []string{"storekeeper", "admin"}},
	{To: "return", Status: StatusReturn, From: []Status{StatusShipped, StatusOrdered, StatusPaid, StatusInTransit, StatusToStock, StatusDone, StatusFinished}, Roles: []string{"manager", "storekeeper", "admin"}},
	{To: "closed", Status: StatusDone, From: []Status{StatusShipped, StatusPrepared, StatusAssembled, StatusReturn}, Roles: []string{"manager", "storekeeper", "admin"}},
	{To: "closed", Status: StatusDone, From: []Status{StatusAssembly}, Roles: []string{"chief_mechanic", "admin"}},
}

// TransitionsFor — все переходы с кодом to (одному коду соответствуют несколько групп from/ролей).
func TransitionsFor(to string) []*Transition {
	var out []*Transition
	for i := range Transitions {
		if Transitions[i].To == to {
			out = append(out, &Transitions[i])
		}
	}
	return out
}

// AllowTransition — разрешён ли переход из from ролью role: возвращает целевой статус 1С.
func AllowTransition(to string, from Status, role string) (Status, error) {
	for _, tr := range TransitionsFor(to) {
		if !contains(tr.Roles, role) {
			continue
		}
		for _, f := range tr.From {
			if f == from {
				return tr.Status, nil
			}
		}
	}
	return "", fmt.Errorf("переход %q недоступен из статуса «%s» для роли %s", to, from.APICode(), role)
}

// ——— Supply (канбан снабжения) ———

// SupplyStatus — канбан снабжения: код → значение 1С и предыдущее значение цепочки.
var SupplyStatus = map[string][2]Status{
	"paid":       {StatusPaid, StatusOrdered},
	"in_transit": {StatusInTransit, StatusPaid},
	"acceptance": {StatusAcceptance, StatusInTransit},
	"to_stock":   {StatusToStock, StatusAcceptance},
	"assembly":   {StatusAssembly, StatusToStock},
	"assembled":  {StatusAssembled, StatusAssembly},
}

// SupplyRoles — кому доступен канбан снабжения.
var SupplyRoles = []string{"supply", "admin", "manager", "storekeeper"}
