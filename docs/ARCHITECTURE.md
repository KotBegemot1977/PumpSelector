# System Architecture & Tech Stack

## Overview
RusPump HQ-Chart is a technical web application designed for digitizing pump curves, calculating polynomial coefficients, and generating performance reports (PDF/PNG). It uses a modern decoupled architecture with a Python/FastAPI backend and a Vite-based frontend.

## Technical Stack

### Frontend
- **Framework**: Vanilla JS + Vite (Module system)
- **Charts**: Apache ECharts (High-performance vector charts)
- **Styling**: Vanilla CSS with a global variable-based design system
- **PDF Generation**: `html2canvas` + `pdf-lib` (Client-side report assembly)
- **Digitizer**: Canvas-based interactive image processing

### Backend
- **Language**: Python 3.14+
- **Framework**: FastAPI (Asynchronous API)
- **Database**: SQLite with SQLModel (ORM)
- **Storage**: Multi-DB approach for security:
  - `pumps.db`: Public pump data and technical specs.
  - `sensitive.db`: Private commercial data (prices, internal names).
  - `drawings.db`: BLOB storage for drawing files (PDF/Images).

## Data Flow Logic

### 1. Calculation & Fitting
- The system uses **Least Squares Regression** to fit 3rd-degree polynomials to raw points.
- **Points Source**: Data from the Digitizer or manual entry is sent to `/api/calculate`.
- **Coeffs Source**: Direct coefficient entry is handled primarily on the client, with saving via `/api/pumps`.

### 2. Synchronization Logic
- **Archive to UI**: 
  - Loading a record saved as "Points" automatically populates both the **Points** and **Coefficients** tabs.
  - Loading a record saved as "Coefficients" only fills the **Coefficients** tab to prevent data contamination.
- **Drawing Persistance**: Global variables `currentDrawPath_calc` and `currentDrawPath_modes` track the relative path of the drawing file to ensure the "📄 Открыть" link is synchronized across views.

## Design System

### Typography
- **Primary**: `Segoe UI` (Engineering standard)
- **Fallback**: System sans-serif
- **Monospace**: `Consolas` (Used for coefficients and numeric precise values)

### Primary Design Tokens
| Token | Value | Purpose |
| :--- | :--- | :--- |
| `--bg-app` | `#f0f2f5` | Main application background |
| `--brand-primary` | `#0056b3` | Primary action buttons and H-Q curves |
| `--brand-success` | `#28a745` | Save buttons and Efficiency curves |
| `--brand-danger` | `#dc3545` | NPSH curves and error messages |
| `--fs-base` | `24px - 28px` | Base font size (scaled for high-res monitors) |

## File Structure
- `/backend`: API logic, models, and database managers.
- `/frontend/src`: UI logic, charting modules, and CSS.
- `/docs`: Technical and user documentation.
