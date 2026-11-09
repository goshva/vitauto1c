package domain

import (
	"testing"
)

// ——— FSM Tests ———

func TestAllowTransition(t *testing.T) {
	tests := []struct {
		to     string
		from   Status
		role   string
		want   Status
		wantOK bool
	}{
		// reserve
		{"reserve", StatusDraft, "manager", StatusReserve, true},
		{"reserve", StatusInWork, "manager", StatusReserve, true},
		{"reserve", StatusPartiallyOrdered, "manager", StatusReserve, true},
		{"reserve", StatusDraft, "storekeeper", "", false},
		{"reserve", StatusShipped, "manager", "", false},
		// assembly
		{"assembly", StatusReserve, "manager", StatusAssembly, true},
		{"assembly", StatusToStock, "manager", StatusAssembly, true},
		{"assembly", StatusAcceptance, "manager", StatusAssembly, true},
		{"assembly", StatusPrepared, "chief_mechanic", StatusAssembly, true},
		{"assembly", StatusAssembled, "admin", StatusAssembly, true},
		{"assembly", StatusReturn, "manager", StatusAssembly, true},
		// ready_to_ship (Собран)
		{"ready_to_ship", StatusAssembly, "storekeeper", StatusAssembled, true},
		{"ready_to_ship", StatusAssembly, "manager", StatusAssembled, true},
		{"ready_to_ship", StatusAssembly, "admin", StatusAssembled, true},
		{"ready_to_ship", StatusAssembly, "supply", "", false},
		// shipped
		{"shipped", StatusPaid, "manager", StatusShipped, true},
		{"shipped", StatusInTransit, "admin", StatusShipped, true},
		{"shipped", StatusToStock, "manager", "", false},
		// acceptance
		{"acceptance", StatusShipped, "storekeeper", StatusAcceptance, true},
		{"acceptance", StatusShipped, "manager", "", false},
		// return
		{"return", StatusShipped, "manager", StatusReturn, true},
		{"return", StatusShipped, "storekeeper", StatusReturn, true},
		{"return", StatusOrdered, "admin", StatusReturn, true},
		{"return", StatusToStock, "admin", StatusReturn, true},
		{"return", StatusDone, "manager", StatusReturn, true},
		// closed
		{"closed", StatusShipped, "manager", StatusDone, true},
		{"closed", StatusShipped, "storekeeper", StatusDone, true},
		{"closed", StatusAssembled, "storekeeper", StatusDone, true},
		{"closed", StatusAssembled, "chief_mechanic", "", false}, // chief_mechanic: closed только из assembly, не из assembled
		{"closed", StatusAssembly, "chief_mechanic", StatusDone, true},
		{"closed", StatusReturn, "manager", StatusDone, true},
	}

	for _, tt := range tests {
		t.Run(tt.to+"_"+string(tt.from)+"_"+tt.role, func(t *testing.T) {
			got, err := AllowTransition(tt.to, tt.from, tt.role)
			if tt.wantOK {
				if err != nil {
					t.Errorf("AllowTransition(%q, %q, %q) error: %v", tt.to, tt.from, tt.role, err)
					return
				}
				if got != tt.want {
					t.Errorf("AllowTransition(%q, %q, %q) = %q, want %q", tt.to, tt.from, tt.role, got, tt.want)
				}
			} else {
				if err == nil {
					t.Errorf("AllowTransition(%q, %q, %q) expected error, got %q", tt.to, tt.from, tt.role, got)
				}
			}
		})
	}
}

func TestAllowTransitionNoTransition(t *testing.T) {
	_, err := AllowTransition("invalid", StatusDraft, "admin")
	if err == nil {
		t.Error("expected error for unknown transition")
	}
}

// ——— Status Tests ———

func TestStatusAPICode(t *testing.T) {
	tests := []struct {
		s  Status
		want string
	}{
		{StatusDraft, "new"},
		{StatusInWork, "in_work"},
		{StatusOrdered, "ordered"},
		{StatusPaid, "paid"},
		{StatusInTransit, "in_transit"},
		{StatusAcceptance, "acceptance"},
		{StatusToStock, "to_stock"},
		{StatusReserve, "reserve"},
		{StatusAssembly, "assembly"},
		{StatusPrepared, "ready_to_ship"},
		{StatusAssembled, "ready_to_ship"},
		{StatusShipped, "shipped"},
		{StatusReturn, "return"},
		{StatusDone, "closed"},
		{StatusFinished, "closed"},
		{StatusLockedBgJob, "locked_background"},
	}
	for _, tt := range tests {
		t.Run(string(tt.s), func(t *testing.T) {
			if got := tt.s.APICode(); got != tt.want {
				t.Errorf("Status(%q).APICode() = %q, want %q", tt.s, got, tt.want)
			}
		})
	}
}

func TestStatusFromAPICode(t *testing.T) {
	tests := []struct {
		code   string
		want   Status
		wantOK bool
	}{
		{"new", StatusDraft, true},
		{"in_work", StatusInWork, true},
		{"ordered", StatusOrdered, true},
		{"paid", StatusPaid, true},
		{"in_transit", StatusInTransit, true},
		{"acceptance", StatusAcceptance, true},
		{"to_stock", StatusToStock, true},
		{"reserve", StatusReserve, true},
		{"assembly", StatusAssembly, true},
		{"ready_to_ship", StatusPrepared, true},
		{"shipped", StatusShipped, true},
		{"return", StatusReturn, true},
		{"closed", StatusDone, true},
		{"locked_background", StatusLockedBgJob, true},
		{"unknown", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.code, func(t *testing.T) {
			got, ok := StatusFromAPICode(tt.code)
			if tt.wantOK {
				if !ok || got != tt.want {
					t.Errorf("StatusFromAPICode(%q) = (%q, %v), want (%q, true)", tt.code, got, ok, tt.want)
				}
			} else {
				if ok {
					t.Errorf("StatusFromAPICode(%q) expected not found", tt.code)
				}
			}
		})
	}
}

func TestIsClosedSale(t *testing.T) {
	if !StatusShipped.IsClosedSale() {
		t.Error("StatusShipped should be closed sale")
	}
	if !StatusDone.IsClosedSale() {
		t.Error("StatusDone should be closed sale")
	}
	if !StatusFinished.IsClosedSale() {
		t.Error("StatusFinished should be closed sale")
	}
	if StatusToStock.IsClosedSale() {
		t.Error("StatusToStock should not be closed sale")
	}
}

// ——— Supply Tests ———

func TestSupplyStatus(t *testing.T) {
	// paid → Заказано -> Оплачено
	ps := SupplyStatus["paid"]
	if ps[0] != StatusPaid {
		t.Errorf("SupplyStatus[paid].0 = %q, want %q", ps[0], StatusPaid)
	}
	if ps[1] != StatusOrdered {
		t.Errorf("SupplyStatus[paid].1 = %q, want %q", ps[1], StatusOrdered)
	}
	// to_stock
	ts := SupplyStatus["to_stock"]
	if ts[0] != StatusToStock {
		t.Errorf("SupplyStatus[to_stock].0 = %q, want %q", ts[0], StatusToStock)
	}
	if ts[1] != StatusAcceptance {
		t.Errorf("SupplyStatus[to_stock].1 = %q, want %q", ts[1], StatusAcceptance)
	}
}

func TestSupplyRoles(t *testing.T) {
	if !contains(SupplyRoles, "supply") {
		t.Error("supply should be in SupplyRoles")
	}
	if !contains(SupplyRoles, "admin") {
		t.Error("admin should be in SupplyRoles")
	}
	if contains(SupplyRoles, "client") {
		t.Error("client should NOT be in SupplyRoles")
	}
}

// ——— Matrix Tests ———

func TestDenyReason(t *testing.T) {
	mr := MatrixFor("manager")
	if len(mr.Columns) == 0 {
		t.Fatal("matrix has no columns for manager")
	}
	// ищем записываемую колонку с правом '+' в статусе new
	var col MatrixColumn
	found := false
	for _, c := range mr.Columns {
		if c.Writable && len(c.Rights) > 0 && c.Rights[0] == '+' {
			col = c
			found = true
			break
		}
	}
	if !found {
		t.Fatal("manager matrix has no writable column allowed in new")
	}
	if deny := DenyReason("manager", col, StatusDraft, false); deny != "" {
		t.Errorf("DenyReason(manager, col %s, Draft, false) = %q, want empty", col.Field, deny)
	}
	// locked status always denied
	deny := DenyReason("manager", col, StatusLockedBgJob, false)
	if deny == "" {
		t.Error("DenyReason should deny for locked status")
	}
	// non-writable column always denied
	ro := MatrixColumn{Field: "ro", Writable: false}
	if DenyReason("manager", ro, StatusDraft, false) == "" {
		t.Error("DenyReason should deny non-writable column")
	}
	// 'c' right: only author
	cRight := MatrixColumn{Field: "author", Writable: true, Rights: "c" + string(make([]byte, len(mr.Statuses)-1))}
	if DenyReason("manager", cRight, StatusDraft, false) == "" {
		t.Error("DenyReason('c', markedByMe=false) should deny")
	}
	if DenyReason("manager", cRight, StatusDraft, true) != "" {
		t.Error("DenyReason('c', markedByMe=true) should allow")
	}
}

func TestMatrixFor(t *testing.T) {
	// unknown role → manager
	mr := MatrixFor("unknown_role")
	if len(mr.Columns) == 0 {
		t.Fatal("MatrixFor(unknown_role) should return manager matrix")
	}
	// known role
	mr2 := MatrixFor("storekeeper")
	if len(mr2.Columns) == 0 {
		t.Fatal("MatrixFor(storekeeper) should return columns")
	}
}

func TestMatrixETag(t *testing.T) {
	etag := MatrixETag()
	if etag == "" {
		t.Error("MatrixETag should not be empty")
	}
}

func TestColumnFor(t *testing.T) {
	// should find at least one column
	mr := MatrixFor("manager")
	found := false
	for _, c := range mr.Columns {
		_, ok := ColumnFor("manager", c.Field)
		if ok {
			found = true
			break
		}
	}
	if !found {
		t.Error("ColumnFor should find at least one column")
	}
	// non-existent field
	_, ok := ColumnFor("manager", "nonexistent_field")
	if ok {
		t.Error("ColumnFor should return false for nonexistent field")
	}
}

// ——— SaleSum Tests ———

func TestSaleSum(t *testing.T) {
	// norm_hours > 0: sale_price * norm_hours
	sum := SaleSum(5.0, 100.0)
	if sum != 500.0 {
		t.Errorf("SaleSum(5, 100) = %v, want 500", sum)
	}
	// norm_hours = 0: sale_price * 1 (fallback)
	sum = SaleSum(0, 100.0)
	if sum != 100.0 {
		t.Errorf("SaleSum(0, 100) = %v, want 100", sum)
	}
}
