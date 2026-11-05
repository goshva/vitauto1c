package domain

import (
	"github.com/google/uuid"
)

// Event — доменное событие, порождённое агрегатом Line.
type Event interface{ eventName() }

// LineStatusChanged — строка перешла в новый статус (M8/M9/M10/M11/K9/M17).
type LineStatusChanged struct {
	LineID    uuid.UUID
	OrderID   *uuid.UUID
	From, To  Status
	Operation Operation
	Actor     uuid.UUID
}

func (e LineStatusChanged) eventName() {}

// AssemblyRequested — кладовщик получил задание на комплектацию (M9).
type AssemblyRequested struct {
	LineID    uuid.UUID
	OrderID   *uuid.UUID
	Actor     uuid.UUID
}

func (e AssemblyRequested) eventName() {}

// AssemblyRejected — M10: комплектация отклонена.
type AssemblyRejected struct {
	LineID    uuid.UUID
	OrderID   *uuid.UUID
	Reason    string
	Actor     uuid.UUID
}

func (e AssemblyRejected) eventName() {}

// GoodsPlaced — закупка размещена на складе (M8).
type GoodsPlaced struct {
	LineID    uuid.UUID
	OrderID   *uuid.UUID
	Actor     uuid.UUID
}

func (e GoodsPlaced) eventName() {}

// SelfPickupRecorded — N4: самовывоз (отгружено с флагом self_pickup).
type SelfPickupRecorded struct {
	LineID    uuid.UUID
	OrderID   *uuid.UUID
	Actor     uuid.UUID
}

func (e SelfPickupRecorded) eventName() {}

// LineAssembled — продажа Собран/Подготовлено (M11).
type LineAssembled struct {
	LineID    uuid.UUID
	OrderID   *uuid.UUID
	Actor     uuid.UUID
}

func (e LineAssembled) eventName() {}

// Shipped — продажа отгружена.
type Shipped struct {
	LineID    uuid.UUID
	OrderID   *uuid.UUID
	Actor     uuid.UUID
}

func (e Shipped) eventName() {}

// GoodsReceived — приёмка закупки (приходная накладная).
type GoodsReceived struct {
	LineID  uuid.UUID
	Actor   uuid.UUID
}

func (e GoodsReceived) eventName() {}

// StockMoved — перемещение склада (FIFO).
type StockMoved struct {
	LineID     uuid.UUID
	NomID      uuid.UUID
	BatchID    *uuid.UUID
	Quantity   float64
	Amount     float64
	IsReturn   bool
	WorkOrder  *uuid.UUID
	Actor      uuid.UUID
}

func (e StockMoved) eventName() {}

// MatrixChanged — матрица роли обновлена (ETag).
type MatrixChanged struct {
	Role string
}

func (e MatrixChanged) eventName() {}
