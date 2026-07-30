import fs from "node:fs"
import path from "node:path"

import { getDirection } from "@/lib/useDirection"

/**
 * Guards the two failure modes that made issue #379 necessary:
 *
 *  1. RTL locale bundles drifting behind en/common.json, which silently falls
 *     back to English text inside an otherwise Arabic or Hebrew UI.
 *  2. direction resolution regressing, which breaks the mirrored layout.
 */

const LOCALES_DIR = path.join(__dirname, "..", "public", "locales")
const NAMESPACE = "common.json"

type Bundle = Record<string, unknown>

function readBundle(locale: string): Bundle {
	const file = path.join(LOCALES_DIR, locale, NAMESPACE)
	return JSON.parse(fs.readFileSync(file, "utf8")) as Bundle
}

/** Flattens nested translation objects into dotted key paths. */
function flatten(bundle: Bundle, prefix = ""): Map<string, string> {
	const out = new Map<string, string>()
	for (const [key, value] of Object.entries(bundle)) {
		const next = prefix ? `${prefix}.${key}` : key
		if (value !== null && typeof value === "object") {
			for (const [k, v] of flatten(value as Bundle, next)) out.set(k, v)
		} else {
			out.set(next, String(value))
		}
	}
	return out
}

/** Extracts i18next interpolation tokens, e.g. "{{balance}}". */
function placeholders(value: string): string[] {
	return (value.match(/\{\{\s*[^}]+\s*\}\}/g) ?? [])
		.map((token) => token.replace(/\s+/g, ""))
		.sort()
}

const english = flatten(readBundle("en"))
const RTL_LOCALES = ["ar", "he"] as const

describe("RTL locale bundles", () => {
	it("has a non-trivial English baseline to compare against", () => {
		expect(english.size).toBeGreaterThan(100)
	})

	describe.each(RTL_LOCALES)("%s/common.json", (locale) => {
		const translated = flatten(readBundle(locale))

		it("translates every English key", () => {
			const missing = [...english.keys()]
				.filter((key) => !translated.has(key))
				.sort()
			expect(missing).toEqual([])
		})

		it("does not define keys that English lacks", () => {
			const extra = [...translated.keys()]
				.filter((key) => !english.has(key))
				.sort()
			expect(extra).toEqual([])
		})

		it("never leaves a translation empty", () => {
			const empty = [...translated.entries()]
				.filter(([, value]) => value.trim() === "")
				.map(([key]) => key)
				.sort()
			expect(empty).toEqual([])
		})

		it("preserves interpolation placeholders", () => {
			const mismatched: string[] = []
			for (const [key, source] of english) {
				const expected = placeholders(source)
				if (expected.length === 0) continue
				const actual = placeholders(translated.get(key) ?? "")
				if (JSON.stringify(expected) !== JSON.stringify(actual)) {
					mismatched.push(key)
				}
			}
			expect(mismatched.sort()).toEqual([])
		})
	})
})

describe("getDirection", () => {
	it.each(["ar", "he"])("reports rtl for %s", (locale) => {
		expect(getDirection(locale)).toBe("rtl")
	})

	it.each(["en", "es", "fr"])("reports ltr for %s", (locale) => {
		expect(getDirection(locale)).toBe("ltr")
	})

	it("handles region-qualified RTL tags", () => {
		expect(getDirection("ar-EG")).toBe("rtl")
	})
})
