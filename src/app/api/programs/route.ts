import { connection } from "next/server";
import { NextResponse } from "next/server";
import { listPrograms, openDb } from "@/lib/db";

export async function GET() {
  await connection(); // opt out of build-time prerendering
  const db = openDb();
  try {
    return NextResponse.json(listPrograms(db));
  } finally {
    db.close();
  }
}
