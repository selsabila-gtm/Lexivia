from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from database import engine, Base

import models
import models_teams
import models_versioning

from routes import router
from user_profile import router as profile_router, competitions_router


app = FastAPI(title="Precision Architect API")


# Uploaded team pictures are served from:
# http://127.0.0.1:8000/uploads/team_logos/filename.png
UPLOAD_DIR = Path("uploads")
TEAM_LOGOS_DIR = UPLOAD_DIR / "team_logos"
TEAM_LOGOS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)


app.include_router(router)
app.include_router(profile_router)
app.include_router(competitions_router)


@app.get("/")
def root():
    return {"status": "Precision Architect API is running"}
