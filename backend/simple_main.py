
from fastapi import FastAPI, Request
import uvicorn

app = FastAPI()

@app.middleware("http")
async def log_requests(request: Request, call_next):
    print(f"DEBUG INCOMING: {request.method} {request.url.path}")
    response = await call_next(request)
    print(f"DEBUG OUTGOING: {response.status_code}")
    return response

@app.get("/")
def read_root():
    return {"Hello": "World"}

@app.get("/api/pumps")
def read_pumps():
    print("INSIDE READ_PUMPS")
    return [{"id": 1, "name": "Test Pump"}]

if __name__ == "__main__":
    print("Starting on port 8081...")
    uvicorn.run(app, host="0.0.0.0", port=8081)
