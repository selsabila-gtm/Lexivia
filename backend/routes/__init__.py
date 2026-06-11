from fastapi import APIRouter

from .auth import router as auth_router
from .competitions import router as competitions_router
from .teams import router as teams_router
from .dashboard import router as dashboard_router
from .data import router as data_router
from .settings import router as settings_router
from .validation import router as validation_router
from .datasets import router as datasets_router
from .experiments import router as experiments_router
from .notifications import router as notifications_router
from .submissions import router as submissions_router
from .scraping import router as scraping_router
from .experiment_registry import router as registry_router

router = APIRouter()

router.include_router(auth_router)
router.include_router(competitions_router)
router.include_router(teams_router)
router.include_router(settings_router)
router.include_router(dashboard_router)
router.include_router(data_router)
router.include_router(validation_router)
router.include_router(datasets_router)
router.include_router(experiments_router)
router.include_router(notifications_router)
router.include_router(submissions_router)
router.include_router(scraping_router)
router.include_router(registry_router)