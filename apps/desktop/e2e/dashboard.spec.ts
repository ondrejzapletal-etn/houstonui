import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
  test('loads dashboard page', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('shows Hello World', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByText('Hello World')).toBeVisible()
  })

  test('shows Houston header', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: 'Houston' })).toBeVisible()
  })
})
