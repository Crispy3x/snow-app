import { describe, expect, it } from "vitest";
import { moveItem, moveToList, nextPosition, removeAndRenumber, renumber, sortByPosition } from "../ordering";

const list = [
  { id: "a", position: 1 },
  { id: "b", position: 2 },
  { id: "c", position: 3 },
];

describe("moveItem", () => {
  it("swaps with the previous item when moving up", () => {
    expect(moveItem(list, "b", "up")).toEqual([
      { id: "b", position: 1 },
      { id: "a", position: 2 },
    ]);
  });

  it("swaps with the next item when moving down", () => {
    expect(moveItem(list, "b", "down")).toEqual([
      { id: "c", position: 2 },
      { id: "b", position: 3 },
    ]);
  });

  it("does nothing at the ends of a tidy list", () => {
    expect(moveItem(list, "a", "up")).toEqual([]);
    expect(moveItem(list, "c", "down")).toEqual([]);
  });

  it("returns nothing for an unknown id", () => {
    expect(moveItem(list, "zzz", "up")).toEqual([]);
  });

  it("works from unsorted input with gaps and repairs the numbering", () => {
    const messy = [
      { id: "c", position: 30 },
      { id: "a", position: 10 },
      { id: "b", position: 20 },
    ];
    const updates = moveItem(messy, "c", "up");
    const result = Object.fromEntries(messy.map((m) => [m.id, updates.find((u) => u.id === m.id)?.position ?? m.position]));
    expect(result).toEqual({ a: 1, c: 2, b: 3 });
  });

  it("repairs duplicates even when the move is impossible", () => {
    const dup = [
      { id: "a", position: 1 },
      { id: "b", position: 1 },
    ];
    expect(moveItem(dup, "a", "up")).toEqual([{ id: "b", position: 2 }]);
  });
});

describe("helpers", () => {
  it("sorts by position then id", () => {
    expect(sortByPosition([{ id: "b", position: 1 }, { id: "a", position: 1 }, { id: "c", position: 0 }]).map((i) => i.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("renumbers only changed rows", () => {
    expect(renumber([{ id: "a", position: 1 }, { id: "b", position: 5 }])).toEqual([{ id: "b", position: 2 }]);
  });

  it("appends after the highest position", () => {
    expect(nextPosition([])).toBe(1);
    expect(nextPosition([{ id: "a", position: 4 }, { id: "b", position: 2 }])).toBe(5);
  });

  it("closes the gap after removal", () => {
    expect(removeAndRenumber(list, "a")).toEqual([
      { id: "b", position: 1 },
      { id: "c", position: 2 },
    ]);
  });

  it("moves an item to the end of another list and renumbers the source", () => {
    const target = [{ id: "x", position: 1 }, { id: "y", position: 2 }];
    expect(moveToList(list, target, "a")).toEqual({
      moved: { id: "a", position: 3 },
      source: [
        { id: "b", position: 1 },
        { id: "c", position: 2 },
      ],
    });
  });
});
