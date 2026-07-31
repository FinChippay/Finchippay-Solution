import { test, expect, type Page } from "@playwright/test"

/**
 * RTL layout coverage (issue #379).
 *
 * Direction in this app is resolved entirely on the client: next.config.mjs uses
 * `output: "export"`, so there is no Next.js i18n routing to drive locale from the
 * URL. `lib/i18n.ts` detects the language from localStorage first, and the
 * DirectionSync component in pages/_app.tsx mirrors that onto
 * <html dir> / <html lang> plus a `data-direction` probe.
 *
 * These tests therefore seed localStorage before the app boots, which exercises
 * the same path a returning user hits.
 */

const LANGUAGE_STORAGE_KEY = "finchippay:lang"

async function bootWithLanguage(page: Page, language: string) {
	await page.addInitScript(
		([key, value]) => {
			window.localStorage.setItem(key, value)
		},
		[LANGUAGE_STORAGE_KEY, language] as const,
	)
	await page.goto("/")
	// DirectionSync runs in an effect, so wait for the probe it renders.
	await page.locator("[data-direction]").first().waitFor({ state: "attached" })
}

const RTL_LANGUAGES = ["ar", "he"] as const

test.describe("RTL support", () => {
	for (const language of RTL_LANGUAGES) {
		test.describe(`language: ${language}`, () => {
			test("sets document direction and language to RTL", async ({ page }) => {
				await bootWithLanguage(page, language)

				const html = page.locator("html")
				await expect(html).toHaveAttribute("dir", "rtl")
				await expect(html).toHaveAttribute("lang", language)
			})

			test("exposes the resolved direction through the probe", async ({
				page,
			}) => {
				await bootWithLanguage(page, language)

				const probe = page.locator("[data-direction]").first()
				await expect(probe).toHaveAttribute("data-direction", "rtl")
				await expect(probe).toHaveAttribute("data-locale", language)
			})

			test("applies a right-to-left computed direction to the body", async ({
				page,
			}) => {
				await bootWithLanguage(page, language)

				const direction = await page.evaluate(
					() => getComputedStyle(document.body).direction,
				)
				expect(direction).toBe("rtl")
			})

			test("does not introduce horizontal overflow", async ({ page }) => {
				await bootWithLanguage(page, language)

				// A mirrored layout that still fits the viewport is the cheapest
				// regression signal for margin/padding that was not flipped.
				const overflow = await page.evaluate(() => {
					const el = document.documentElement
					return el.scrollWidth - el.clientWidth
				})
				expect(overflow).toBeLessThanOrEqual(1)
			})

			test("renders localized navigation text, not raw i18n keys", async ({
				page,
			}) => {
				await bootWithLanguage(page, language)

				const nav = page.locator("nav").first()
				await expect(nav).toBeVisible()

				// Missing translations surface as dotted key paths such as "nav.home".
				const navText = (await nav.innerText()).trim()
				expect(navText.length).toBeGreaterThan(0)
				expect(navText).not.toMatch(/\b(nav|home|dashboard|settings)\.[a-zA-Z]/)
			})
		})
	}

	test("keeps English left-to-right", async ({ page }) => {
		await bootWithLanguage(page, "en")

		const html = page.locator("html")
		await expect(html).toHaveAttribute("dir", "ltr")
		await expect(html).toHaveAttribute("lang", "en")

		const direction = await page.evaluate(
			() => getComputedStyle(document.body).direction,
		)
		expect(direction).toBe("ltr")
	})

	test("switching from Arabic back to English restores LTR", async ({
		page,
	}) => {
		await bootWithLanguage(page, "ar")
		await expect(page.locator("html")).toHaveAttribute("dir", "rtl")

		// i18n.changeLanguage is what LanguageSwitcher ultimately calls; driving it
		// directly keeps this test independent of the switcher's markup.
		await page.evaluate(() => {
			window.localStorage.setItem("finchippay:lang", "en")
		})
		await page.reload()
		await page.locator("[data-direction]").first().waitFor({ state: "attached" })

		await expect(page.locator("html")).toHaveAttribute("dir", "ltr")
	})
})
