// Типы описи копии.
//
// Отдельным файлом, потому что их читают все три команды (снятие, проверка,
// восстановление), а `backup-lib.ts` вышел за предел экспортов: 13 при лимите 5 из §12.
// Деление по назначению, а не по размеру: типы, доступ к базе, работа с файлами.

export interface TableFingerprint {
  table: string;
  rows: number;
  /** Контрольная сумма содержимого: все строки по порядку. */
  checksum: string;
}

export interface Manifest {
  createdAt: string;
  database: string;
  file: string;
  bytes: number;
  /** Контрольная сумма самого файла копии. */
  fileSha256: string;
  pgDumpVersion: string;
  tables: TableFingerprint[];
  /** Итог по всем таблицам — чтобы сравнить одной строкой. */
  totalRows: number;
  totalChecksum: string;
}

export interface BackupFile {
  /** Время из имени файла. */
  stamp: string;
  dump: string;
  manifest: string;
  bytes: number;
}
