import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const directory = process.env.MYVAULT_BACKUP_COMPAT_DIR;
const android = process.env.MYVAULT_ANDROID_PROJECT;
assert.ok(directory && android);
const schema = JSON.parse(readFileSync(join(android, "app/schemas/com.myvault.app.data.local.VaultDatabase/32.json"), "utf8"));
const instructions = JSON.parse(readFileSync(join(directory, "deletion-sql.json"), "utf8"));
const db = new DatabaseSync(":memory:");
try {
  const tables = new Set();
  const snapshots = new Map();
  db.exec("PRAGMA foreign_keys = ON");
  for (const entity of schema.database.entities) {
    if (entity.tableName === "notes_fts" || entity.tableName.startsWith("record_sync_")) continue;
    db.exec(entity.createSql.replaceAll("${TABLE_NAME}", entity.tableName));
    tables.add(entity.tableName);
    const values = entity.fields.map((field) => {
      if (!field.notNull && !entity.primaryKey.columnNames.includes(field.columnName)) return null;
      return field.affinity === "INTEGER" ? 1 : field.affinity === "REAL" ? 1.5 : "fixture-survivor";
    });
    const columns = entity.fields.map((field) => `\`${field.columnName}\``).join(",");
    db.prepare(`INSERT INTO \`${entity.tableName}\` (${columns}) VALUES (${values.map(() => "?").join(",")})`).run(...values);
    snapshots.set(entity.tableName, JSON.stringify(db.prepare(`SELECT * FROM \`${entity.tableName}\``).all()));
  }
  assert.equal(tables.size, 20);
  const noteColumns = schema.database.entities.find((entity) => entity.tableName === "notes").fields.map((field) => field.columnName);
  db.prepare(`INSERT INTO notes (${noteColumns.map((column) => `\`${column}\``).join(",")}) SELECT ${noteColumns.map((column) => column === "id" ? "?" : `\`${column}\``).join(",")} FROM notes LIMIT 1`).run("explicitly-deleted-note");
  for (const instruction of instructions) {
    const table = instruction.sql.match(/DELETE FROM `([^`]+)`/)[1];
    assert.ok(tables.has(table));
    db.prepare(instruction.sql).run(...instruction.args);
  }
  for (const [table, snapshot] of snapshots) {
    assert.equal(JSON.stringify(db.prepare(`SELECT * FROM \`${table}\``).all()), snapshot, `${table}: unrelated records must survive`);
  }
  assert.equal(db.prepare("SELECT count(*) AS n FROM notes WHERE id = ?").get("explicitly-deleted-note").n, 0);
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  console.log("PASS Android-generated bound deletion SQL against disposable schema-32 SQLite: all 20 unrelated user tables preserved, exact note deleted, integrity clean. No production database opened.");
} finally { db.close(); }
