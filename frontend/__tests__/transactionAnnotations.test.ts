import {
  getAnnotation,
  setNote,
  toggleBookmark,
  addTag,
  removeTag,
  getAllTags,
  getBookmarkedIds,
} from "@/lib/transactionAnnotations";

describe("transactionAnnotations lib", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns undefined for unannotated transactions", () => {
    expect(getAnnotation("missing")).toBeUndefined();
  });

  it("sets and reads a note", () => {
    setNote("tx-1", "hello world");
    expect(getAnnotation("tx-1")?.note).toBe("hello world");
  });

  it("toggles bookmark and reads bookmarked ids", () => {
    expect(toggleBookmark("tx-1")).toBe(true);
    expect(toggleBookmark("tx-1")).toBe(false);
    toggleBookmark("tx-2");
    expect(getBookmarkedIds()).toEqual(["tx-2"]);
  });

  it("adds unique tags (lowercased)", () => {
    addTag("tx-1", "Rent");
    addTag("tx-1", "rent");
    addTag("tx-1", "payroll");
    const annotation = getAnnotation("tx-1");
    expect(annotation?.tags).toEqual(["rent", "payroll"]);
  });

  it("removes a tag", () => {
    addTag("tx-1", "rent");
    addTag("tx-1", "payroll");
    removeTag("tx-1", "rent");
    expect(getAnnotation("tx-1")?.tags).toEqual(["payroll"]);
  });

  it("lists all unique tags across transactions", () => {
    addTag("tx-1", "rent");
    addTag("tx-2", "payroll");
    addTag("tx-2", "rent");
    expect(getAllTags()).toEqual(["payroll", "rent"]);
  });

  it("deletes the annotation entry when it becomes empty", () => {
    addTag("tx-1", "rent");
    removeTag("tx-1", "rent");
    expect(getAnnotation("tx-1")).toBeUndefined();
  });
});