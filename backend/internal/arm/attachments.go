package arm

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Вложения карточек (ТЗ 2.1: фото неопознанных позиций и номенклатуры).
// Файлы хранятся в БД (bytea) — на объёмах демо-стенда это проще бэкапа и переноса.
// Ограничение размера — 5 МБ, только изображения.

const maxAttachmentSize = 5 << 20

var attachmentRoles = []string{"admin", "manager", "chief_mechanic", "storekeeper"}

var attachmentOwners = map[string]string{
	"nomenclature": "ref.nomenclature",
	"unidentified": "doc.unidentified_item",
	"car":          "ref.car",
}

const attachmentJSON = `jsonb_build_object('id', id, 'ownerType', owner_type, 'ownerId', owner_id,
	'name', file_name, 'contentType', content_type, 'size', size,
	'url', '/api/v1/attachments/' || id, 'createdAt', to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS'))`

// AttachmentCreate — POST /attachments (multipart), файл прикрепляется к карточке.
func (s *Service) AttachmentCreate(ctx context.Context, a Actor, ownerType, ownerID, fileName, contentType string, data []byte) (json.RawMessage, error) {
	if !contains(attachmentRoles, a.Role) {
		return nil, fail(403, "matrix_denied", "Загрузка файлов доступна ролям менеджер, кладовщик, механик и администратор")
	}
	table, ok := attachmentOwners[ownerType]
	if !ok {
		return nil, fail(400, "bad_request", "ownerType: nomenclature, unidentified или car", "ownerType")
	}
	if len(data) == 0 {
		return nil, fail(400, "bad_request", "Файл пустой", "file")
	}
	if len(data) > maxAttachmentSize {
		return nil, fail(413, "too_large", "Файл больше 5 МБ", "file")
	}
	if !strings.HasPrefix(contentType, "image/") {
		return nil, fail(400, "bad_request", "Загружать можно только изображения", "file")
	}
	owner, err := uuid.Parse(ownerID)
	if err != nil {
		return nil, fail(400, "bad_request", "ownerId: нужен идентификатор карточки", "ownerId")
	}
	if fileName == "" {
		fileName = "photo"
	}
	id := uuid.Must(uuid.NewV7())
	err = s.inTx(ctx, a, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `select exists(select 1 from `+table+` where id = $1)`, owner).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fail(404, "not_found", "Карточка для вложения не найдена", "ownerId")
		}
		_, err := tx.Exec(ctx, `insert into ref.attachment (id, owner_type, owner_id, file_name, content_type, size, data, author_id)
			values ($1, $2, $3, $4, $5, $6, $7, $8)`, id, ownerType, owner, fileName, contentType, len(data), data, nullable(a.UserID))
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.AttachmentGet(ctx, id.String())
}

// AttachmentGet — метаданные вложения.
func (s *Service) AttachmentGet(ctx context.Context, id string) (json.RawMessage, error) {
	iid, err := uuid.Parse(id)
	if err != nil {
		return nil, fail(404, "not_found", "Вложение не найдено")
	}
	var b []byte
	err = s.DB.QueryRow(ctx, `select `+attachmentJSON+` from ref.attachment where id = $1 and not deleted`, iid).Scan(&b)
	if err == pgx.ErrNoRows {
		return nil, fail(404, "not_found", "Вложение не найдено")
	}
	return b, err
}

// AttachmentRead — GET /attachments/{id}: байты файла для <img>.
func (s *Service) AttachmentRead(ctx context.Context, id string) (data []byte, contentType, fileName string, err error) {
	iid, err := uuid.Parse(id)
	if err != nil {
		return nil, "", "", fail(404, "not_found", "Вложение не найдено")
	}
	err = s.DB.QueryRow(ctx, `select data, content_type, file_name from ref.attachment where id = $1 and not deleted`, iid).Scan(&data, &contentType, &fileName)
	if err == pgx.ErrNoRows {
		return nil, "", "", fail(404, "not_found", "Вложение не найдено")
	}
	return data, contentType, fileName, err
}

// AttachmentDelete — DELETE /attachments/{id}: пометка удаления, файл остаётся в БД.
func (s *Service) AttachmentDelete(ctx context.Context, a Actor, id string) error {
	if !contains(attachmentRoles, a.Role) {
		return fail(403, "matrix_denied", "Удаление файлов доступно ролям менеджер, кладовщик, механик и администратор")
	}
	iid, err := uuid.Parse(id)
	if err != nil {
		return fail(404, "not_found", "Вложение не найдено")
	}
	tag, err := s.DB.Exec(ctx, `update ref.attachment set deleted = true where id = $1 and not deleted`, iid)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fail(404, "not_found", "Вложение не найдено")
	}
	return nil
}

// AttachmentList — список вложений карточки (для карточки номенклатуры).
func (s *Service) AttachmentList(ctx context.Context, ownerType, ownerID string) ([]json.RawMessage, error) {
	owner, err := uuid.Parse(ownerID)
	if err != nil {
		return nil, fail(400, "bad_request", "ownerId: нужен идентификатор карточки", "ownerId")
	}
	return jsonRows(ctx, s.DB, `select `+attachmentJSON+` from ref.attachment
		where owner_type = $1 and owner_id = $2 and not deleted order by created_at`, ownerType, owner)
}
