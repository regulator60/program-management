import { DatabaseSync } from "node:sqlite";

export type Program = {
  id: number;
  name: string;
  owner: string;
  status: "planned" | "active" | "done";
};

export function openDb(path = process.env.DATABASE_PATH ?? "data/app.db") {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned'
  )`);
  return db;
}

export function addProgram(
  db: DatabaseSync,
  p: Omit<Program, "id" | "status"> & { status?: Program["status"] },
) {
  db.prepare("INSERT INTO programs (name, owner, status) VALUES (?, ?, ?)").run(
    p.name,
    p.owner,
    p.status ?? "planned",
  );
}

export function listPrograms(db: DatabaseSync): Program[] {
  return db.prepare("SELECT * FROM programs ORDER BY id").all() as Program[];
}
