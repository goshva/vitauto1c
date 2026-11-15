import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pool } from '../../src/db.ts';
import { PG_BIN, dbUrl, pgEnv, snapshot, totals } from '../../scripts/backup-lib.ts';
import { fileSha256, listBackups, prune, stampName } from '../../scripts/backup-files.ts';
import type { Manifest } from '../../scripts/backup-types.ts';

// Резервное копирование: проверки.
//
// ГЛАВНЫЙ ТЕСТ ЗДЕСЬ — НЕ ТОТ, ЧТО КОПИЯ ПРОХОДИТ ПРОВЕРКУ, А ТОТ, ЧТО ПЛОХАЯ КОПИЯ
// ЕЁ НЕ ПРОХОДИТ. Проверка, которая всегда говорит «годна», — это печать, а не
// проверка: она успокаивает и ничего не доказывает. Поэтому здесь есть испорченный
// дамп и подменённая опись, и на каждом проверка обязана отказать.
//
// Полный цикл (снять → восстановить → сверить) проверяется запуском настоящих команд:
// иначе тестировались бы только вспомогательные функции, а не то, что делают в аварии.

let dir = '';

const env = pgEnv();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vitauto-backup-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Настоящая копия базы во временную папку. Одна на файл — снимать её долго. */
function realBackup(): string {
  execFileSync('bun', ['run', 'scripts/backup.ts', '--dir', dir, '--keep', '7'], {
    encoding: 'utf8', env: { ...env, DATABASE_URL: dbUrl() },
  });
  const [first] = listBackups(dir);
  return first!.stamp;
}

// Слепок 34 таблиц идёт около двух секунд: три вызова не укладываются в пять
// секунд по умолчанию, и тест падал по времени, а не по существу.
const SLOW = 60_000;

describe('копии · слепок содержимого', () => {
  test('слепок снимается со всех таблиц и совпадает с прямым подсчётом', async () => {
    const snap = snapshot(dbUrl(), env);
    expect(snap.length, 'таблиц в слепке подозрительно мало').toBeGreaterThan(30);

    // Сверяем не «сколько таблиц», а СОСТОЯНИЕ: число строк в слепке обязано совпасть
    // с запросом к базе, иначе слепок бесполезен как доказательство.
    const line = snap.find((t) => t.table === 'line')!;
    const direct = Number((await pool.query<{ n: string }>(
      `select count(*)::text n from line`)).rows[0]!.n);
    expect(line.rows, 'слепок разошёлся с базой').toBe(direct);
    expect(line.checksum.length, 'у таблицы нет контрольной суммы').toBe(32);
  }, SLOW);

  test('представления в слепок не попадают — они не данные', () => {
    const names = snapshot(dbUrl(), env).map((t) => t.table);
    // Представление — это запрос, а не данные: в дампе данных его нет.
    expect(names, 'в слепок попало представление').not.toContain('line_view');
    // А вот `audit_log` — обычная таблица, и в слепке ей быть ПОЛОЖЕНО. Первая
    // версия теста этого не различала.
    expect(names).toContain('audit_log');
  });

  test('итог меняется при изменении содержимого и устойчив при том же', async () => {
    // ПОДГОТОВКА ДО СНЯТИЯ СЛЕПКА, а не после проверок. Первая версия убирала за
    // собой в конце теста — и после падения оставляла комментарий в базе. Следующий
    // прогон ставил ТО ЖЕ значение, правка не меняла содержимое, и тест падал уже
    // не на своей ошибке. Тест не должен зависеть от предыдущего прогона.
    await pool.query(`update line set comment = null where comment = 'проба слепка'`);

    try {
      const before = totals(snapshot(dbUrl(), env));

      await pool.query(`update line set comment = 'проба слепка' where not deleted`);
      const changed = totals(snapshot(dbUrl(), env));

      expect(changed.checksum, 'слепок не заметил правку').not.toBe(before.checksum);
      expect(changed.rows, 'изменилось число строк при правке').toBe(before.rows);

      // И обратно — устойчивость: тот же слепок при том же содержимом.
      const again = totals(snapshot(dbUrl(), env));
      expect(again.checksum).toBe(changed.checksum);
    } finally {
      await pool.query(`update line set comment = null where comment = 'проба слепка'`);
    }
  }, SLOW);

  test('в запросе слепка нет ни одного не-ASCII символа', () => {
    // Кириллица в аргументе командной строки Windows перекодируется в CP866, и psql
    // падает на `invalid byte sequence`. Первая версия писала `'пусто'` и падала.
    // Проверяем не «в файле нет кириллицы» (в комментариях она есть и нужна), а что
    // сам скрипт не собирает SQL с русскими литералами.
    const src = readFileSync('scripts/backup-lib.ts', 'utf8');
    const queries = [...src.matchAll(/`(select[\s\S]*?)`/g)].map((m) => m[1]!);
    expect(queries.length, 'не нашёл ни одного запроса').toBeGreaterThan(0);
    for (const q of queries) {
      expect(/[\u0400-\u04FF]/.test(q), `в запросе есть кириллица: ${q.slice(0, 60)}`).toBe(false);
    }
  });
});

describe('копии · имена, перечень, уборка', () => {
  test('имя копии — время, и оно сортируется как время', () => {
    const a = stampName(new Date(2026, 10, 15, 9, 5, 3));
    const b = stampName(new Date(2026, 10, 15, 16, 20, 56));
    expect(a).toBe('20261115-090503');
    expect(b).toBe('20261115-162056');
    expect(a < b, 'имена не сортируются по времени').toBe(true);
  });

  test('перечень отдаёт свежие первыми', () => {
    for (const s of ['20261115-100000', '20261115-120000', '20261115-110000']) {
      writeFileSync(join(dir, `vitauto-${s}.dump`), 'x');
      writeFileSync(join(dir, `vitauto-${s}.json`), '{}');
    }
    expect(listBackups(dir).map((b) => b.stamp))
      .toEqual(['20261115-120000', '20261115-110000', '20261115-100000']);
  });

  test('уборка оставляет ровно N свежих', () => {
    for (const s of ['20261115-100000', '20261115-110000', '20261115-120000', '20261115-130000']) {
      writeFileSync(join(dir, `vitauto-${s}.dump`), 'x');
      writeFileSync(join(dir, `vitauto-${s}.json`), '{}');
    }

    const removed = prune(dir, 2);
    expect(removed.map((b) => b.stamp)).toEqual(['20261115-110000', '20261115-100000']);
    expect(listBackups(dir).map((b) => b.stamp)).toEqual(['20261115-130000', '20261115-120000']);
  });

  test('уборка сносит опись вместе с копией', () => {
    writeFileSync(join(dir, 'vitauto-20261115-100000.dump'), 'x');
    writeFileSync(join(dir, 'vitauto-20261115-100000.json'), '{}');
    writeFileSync(join(dir, 'vitauto-20261115-110000.dump'), 'x');
    writeFileSync(join(dir, 'vitauto-20261115-110000.json'), '{}');

    prune(dir, 1);
    // Опись без копии опасна: она выглядит как копия, а восстановить из неё нечего.
    expect(existsSync(join(dir, 'vitauto-20261115-100000.json')), 'опись осталась без копии')
      .toBe(false);
    expect(existsSync(join(dir, 'vitauto-20261115-110000.json'))).toBe(true);
  });

  test('пустая папка не считается ошибкой', () => {
    expect(listBackups(dir)).toEqual([]);
    expect(prune(dir, 7)).toEqual([]);
  });
});

describe('копии · ПРОВЕРКА ЛОВИТ ПЛОХУЮ КОПИЮ', () => {
  test('испорченный файл: контрольная сумма расходится с описью', () => {
    writeFileSync(join(dir, 'vitauto-20261115-100000.dump'), 'настоящая копия целиком');
    const good = fileSha256(join(dir, 'vitauto-20261115-100000.dump'));

    // Обрезали — как при нехватке места на диске.
    truncateSync(join(dir, 'vitauto-20261115-100000.dump'), 10);
    const cut = fileSha256(join(dir, 'vitauto-20261115-100000.dump'));

    expect(cut, 'обрезка не изменила контрольную сумму').not.toBe(good);
  });

  test('подменённая копия: файл другой, а имя и размер похожи', () => {
    const path = join(dir, 'vitauto-20261115-100000.dump');
    writeFileSync(path, 'A'.repeat(500));
    const original = fileSha256(path);

    // Тот же размер — «на глаз» неотличимо. Контрольная сумма обязана заметить.
    writeFileSync(path, 'B'.repeat(500));
    expect(fileSha256(path), 'подмена того же размера не замечена').not.toBe(original);
  });

  test('полный цикл: копия снимается, восстанавливается и СХОДИТСЯ', () => {
    const stamp = realBackup();

    // Смотрим ОБА потока: часть вывода идёт в stderr, и без него в сообщении об
    // ошибке не видно, что именно отказало.
    let out = '';
    try {
      out = execFileSync('bun', ['run', 'scripts/backup-verify.ts', stamp, '--dir', dir], {
        encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      throw new Error(`проверка упала:\n${err.stdout ?? ''}\n${err.stderr ?? ''}`);
    }

    expect(out, 'проверка не признала годную копию').toContain('КОПИЯ ГОДИТСЯ');
    // Ключевое: проверка сравнивает СОДЕРЖИМОЕ, а не только факт восстановления.
    expect(out).toContain('содержимое: совпало');
  }, SLOW);

  test('полный цикл: ИСПОРЧЕННАЯ копия проверку НЕ проходит', () => {
    const stamp = realBackup();

    // Портим файл, оставив опись как была, — так выгля��ит копия, усечённая при
    // записи на диск. Проверка обязана отказать, а не «восстановить что получится».
    const dump = join(dir, `vitauto-${stamp}.dump`);
    const size = readFileSync(dump).length;
    truncateSync(dump, Math.floor(size / 2));

    let failed = false;
    let out = '';
    try {
      out = execFileSync('bun', ['run', 'scripts/backup-verify.ts', stamp, '--dir', dir], {
        encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      failed = true;
      const err = e as { stdout?: string; stderr?: string };
      // Вердикт печатается в stderr — смотрим оба потока.
      out = `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
    }

    expect(failed, 'ПРОВЕРКА ПРОПУСТИЛА ИСПОРЧЕННУЮ КОПИЮ — она бесполезна').toBe(true);
    expect(out, 'отказ не назвал причину').toContain('КОПИЯ НЕ ГОДИТСЯ');
  }, SLOW);

  test('копия без описи не проверяется вовсе — проверять нечем', () => {
    writeFileSync(join(dir, 'vitauto-20261115-100000.dump'), 'x');

    let failed = false;
    try {
      execFileSync('bun', ['run', 'scripts/backup-verify.ts', '--dir', dir], { encoding: 'utf8', env });
    } catch { failed = true; }

    expect(failed, 'копия без описи прошла проверку').toBe(true);
  }, SLOW);

  test('восстановление без явной целевой базы отказывает', () => {
    writeFileSync(join(dir, 'vitauto-20261115-100000.dump'), 'x');
    writeFileSync(join(dir, 'vitauto-20261115-100000.json'), JSON.stringify({ fileSha256: '—' }));

    let failed = false;
    try {
      execFileSync('bun', ['run', 'scripts/restore.ts', '--dir', dir], { encoding: 'utf8', env });
    } catch { failed = true; }

    // Команда, которая по умолчанию бьёт в рабочую базу, однажды сработает по ошибке —
    // и восстанавливать будет уже нечего.
    expect(failed, 'восстановление без --to не отказало').toBe(true);
  }, SLOW);

  test('восстановление в отдельную базу ДЕЙСТВИТЕЛЬНО работает', () => {
    // ЭТОТ ПУТЬ ИДЁТ В ДЕНЬ АВАРИИ, И ЕГО НАДО ПРОВЕРЯТЬ ЦЕЛИКОМ. Первая версия
    // теста смотрела только на отказ без `--to` — и пропустила, что `restore.ts`
    // потерял импорты node и на настоящем восстановлении упал бы. Тест, который
    // смотрит только на отказы, работы не проверяет.
    const stamp = realBackup();
    const target = `vitauto_restore_check_${stamp.replace(/\D/g, '')}`;

    try {
      const out = execFileSync('bun', [
        'run', 'scripts/restore.ts', stamp, '--dir', dir, '--to', target, '--create',
      ], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
      expect(out, 'восстановление не отчиталось').toContain('восстановлено');

      // И главное: в восстановленной базе ДЕЙСТВИТЕЛЬНО те данные.
      const manifest = JSON.parse(
        readFileSync(join(dir, `vitauto-${stamp}.json`), 'utf8')) as Manifest;
      expect(totals(snapshot(dbUrl(target), env)).checksum,
        'восстановленная база не совпала с описью копии').toBe(manifest.totalChecksum);
    } finally {
      execFileSync(`${PG_BIN}\\dropdb.exe`,
        [`--maintenance-db=${dbUrl('postgres')}`, '--if-exists', '--force', target],
        { env, stdio: 'ignore' });
    }
  }, SLOW);

  test('опись содержит версию pg_dump — копию чужой версии видно заранее', () => {
    const stamp = realBackup();
    const m = JSON.parse(readFileSync(join(dir, `vitauto-${stamp}.json`), 'utf8')) as Manifest;
    expect(m.pgDumpVersion).toContain('pg_dump');
    expect(m.fileSha256.length).toBe(64);
    expect(m.totalRows).toBeGreaterThan(0);
    expect(m.tables.length).toBeGreaterThan(30);
  }, SLOW);
});
