import subprocess
import time
import sys
import os
import requests

def wait_for_server(url, timeout=10):
    start = time.time()
    while time.time() - start < timeout:
        try:
            requests.get(url)
            return True
        except:
            time.sleep(0.5)
    return False

def run_e2e():
    print("Starting backend server for E2E tests...")
    # Start backend in background
    # Ensure we use the right python and paths
    env = os.environ.copy()
    env["PYTHONPATH"] = os.getcwd()
    
    # We use Popen to start it non-blocking
    server = subprocess.Popen(
        [sys.executable, "backend/main.py"], 
        cwd=os.getcwd(),
        env=env,
        stdout=subprocess.DEVNULL, # Suppress output to keep test logs clean
        stderr=subprocess.DEVNULL
    )
    
    try:
        print("Waiting for server to be ready...")
        if wait_for_server("http://localhost:8000"):
            print("Server ready! Running Playwright tests...")
            # Run pytest for e2e
            result = subprocess.run([sys.executable, "-m", "pytest", "tests/e2e/test_scenarios.py"], capture_output=False)
            print(f"Tests finished with code {result.returncode}")
        else:
            print("Server failed to start in time.")
    finally:
        print("Stopping server...")
        server.terminate()
        server.wait()

if __name__ == "__main__":
    run_e2e()
