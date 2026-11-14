import { expect, test } from "vitest";
import { addProgram, listPrograms, openDb } from "./db";

test("adds and lists programs", () => {
  const db = openDb(":memory:");
  addProgram(db, { name: "Launch", owner: "Sam" });
  expect(listPrograms(db)).toEqual([
    { id: 1, name: "Launch", owner: "Sam", status: "planned" },
  ]);
});
