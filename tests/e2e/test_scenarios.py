import pytest
import os
import re
from playwright.sync_api import Page, expect

# Constants
BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000")

def test_page_load(page: Page):
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    
    # Use regex for title
    expect(page).to_have_title(re.compile("RusPump"), timeout=15000)
    
    # Check for tabs - use exact text to avoid ambiguity
    expect(page.get_by_text("Оцифровщик", exact=True)).to_be_visible(timeout=15000)
    expect(page.get_by_text("Подбор", exact=True)).to_be_visible(timeout=15000)

def test_points_entry_and_calc(page: Page):
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    
    # Click the "Points" tab
    page.get_by_text("Построение по точкам", exact=True).click()
    
    # Fill data
    page.locator("#qText").fill("0 10 20 30")
    page.locator("#hText").fill("50 48 44 38")
    
    # Click Calc button
    page.get_by_text("РАССЧИТАТЬ ГРАФИК").first.click()
    
    # Check if chart canvas appears
    expect(page.locator("#chartCombo1 canvas")).to_be_visible(timeout=20000)

def test_smart_selection(page: Page):
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    
    # Switch to Selection tab - use exact match to avoid "ПОДБОР НАСОСОВ" conflict
    page.get_by_text("Подбор", exact=True).click()
    
    # Fill search criteria
    page.locator("#sel-q").fill("20")
    page.locator("#sel-h").fill("45")
    page.locator("#sel-tol").fill("10")
    
    # Click Search
    page.locator("#btn-search").click()
    
    # Verify table visibility
    expect(page.locator("#sel-table-body")).to_be_visible(timeout=15000)

def test_digitizer_ui(page: Page):
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    
    # Switch to Digitizer
    page.get_by_text("Оцифровщик", exact=True).click()
    
    # Check canvas and the upload button
    expect(page.locator("#digiCanvas")).to_be_visible(timeout=15000)
    expect(page.get_by_text("📂 ЗАГРУЗИТЬ (IMG/PDF)")).to_be_visible(timeout=15000)
