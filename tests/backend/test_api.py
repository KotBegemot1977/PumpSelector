import pytest
import json

@pytest.mark.asyncio
async def test_read_pumps(ac):
    response = await ac.get("/api/pumps")
    assert response.status_code == 200
    assert isinstance(response.json(), list)

@pytest.mark.asyncio
async def test_calculate_standard(ac):
    payload = {
        "q_text": "0 10 20 30",
        "h_text": "50 45 35 20",
        "save": "false"
    }
    response = await ac.post("/api/calculate", data=payload)
    assert response.status_code == 200
    data = response.json()
    assert "h_coeffs" in data
    assert len(data["h_coeffs"]) == 4

@pytest.mark.asyncio
async def test_calculate_modes(ac):
    # MODES format: q_text="MODES", h_text=json_coeffs
    payload = {
        "q_text": "MODES",
        "h_text": json.dumps([0, 0, -0.01, 50]),
        "eff_text": json.dumps([0, 0, 0, 80]),
        "p2_text": json.dumps([0, 0, 0, 10]),
        "npsh_text": json.dumps([0, 0, 0, 2]),
        "q_min": "0", "q_max": "100",
        "h_min": "0", "h_max": "100",
        "q_req": "25", "h_req": "40",
        "save": "false"
    }
    response = await ac.post("/api/calculate", data=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["h_coeffs"] == [0, 0, -0.01, 50]

@pytest.mark.asyncio
async def test_selection_search(ac):
    payload = {
        "q_req": 30,
        "h_req": 40,
        "tolerance_percent": 20
    }
    response = await ac.post("/api/selection/search", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    # Check structure of results if any
    if len(data) > 0:
        assert "pump" in data[0]
        assert "deviation_percent" in data[0]
