package onec

import (
	"encoding/hex"
	"testing"

	"github.com/google/uuid"
)

// Справочник.Номенклатура «НФ-00000001» в vitauto_dev: _IDRRef и УникальныйИдентификатор() (гейт G0.3).
const (
	sampleHex  = "8dd600155d00360911f08fc9dba691ea"
	sampleUUID = "dba691ea-8fc9-11f0-8dd6-00155d003609"
)

func TestUUIDFromIDRRef(t *testing.T) {
	b, _ := hex.DecodeString(sampleHex)
	u, ok, err := UUIDFromIDRRef(b)
	if err != nil || !ok || u.String() != sampleUUID {
		t.Fatalf("got %s %v %v, want %s", u, ok, err, sampleUUID)
	}
	if got := hex.EncodeToString(IDRRefFromUUID(u)); got != sampleHex {
		t.Fatalf("обратный перевод: %s", got)
	}
	if u, ok, _ := UUIDFromHex(`\x` + sampleHex); !ok || u.String() != sampleUUID {
		t.Fatalf("hex: %s", u)
	}
}

func TestEmptyRef(t *testing.T) {
	if _, ok, err := UUIDFromIDRRef(make([]byte, 16)); ok || err != nil {
		t.Fatal("пустая ссылка должна давать ok=false без ошибки")
	}
	if _, _, err := UUIDFromIDRRef([]byte{1, 2}); err == nil {
		t.Fatal("ожидалась ошибка длины")
	}
}

func TestDeterministicIDs(t *testing.T) {
	owner := uuid.MustParse(sampleUUID)
	if TabularID(owner, 1) != TabularID(owner, 1) || TabularID(owner, 1) == TabularID(owner, 2) {
		t.Fatal("TabularID должен быть детерминированным и различать строки")
	}
	if ArmLineID(sampleUUID).String() != sampleUUID {
		t.Fatal("GUID-идентификатор строки АРМ сохраняется как есть")
	}
	if ArmLineID("abc") != ArmLineID("abc") || ArmLineID("abc") == ArmLineID("abd") {
		t.Fatal("ArmLineID для не-GUID")
	}
}
