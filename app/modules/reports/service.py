"""Build combined work and lifestyle reports."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.modules.lifestyle.service import LifestyleService, LifestyleSummary
from app.modules.work.service import WorkSessionService, WorkSummary


@dataclass(frozen=True, slots=True)
class LifeWorkReport:
    """Combined deterministic report for one user and time interval."""

    period_hours: int
    work: WorkSummary
    lifestyle: LifestyleSummary


def _format_minutes(minutes: int) -> str:
    """Format a nonnegative minute count using hours and minutes."""
    hours, remaining_minutes = divmod(max(0, minutes), 60)
    if hours:
        return f"{hours} ساعت و {remaining_minutes} دقیقه"
    return f"{remaining_minutes} دقیقه"


class ReportService:
    """Create and render combined work and lifestyle reports."""

    def __init__(self, db: Session) -> None:
        """Initialize the service with a database session."""
        self._db = db

    def create_report(
        self,
        telegram_id: int,
        period_hours: int = 24,
        *,
        until: datetime | None = None,
    ) -> LifeWorkReport:
        """Aggregate the user's work and lifestyle data for up to one week."""
        if not 1 <= period_hours <= 168:
            raise ValueError("Report period must be between 1 and 168 hours.")

        end = until or datetime.now(timezone.utc)
        start = end - timedelta(hours=period_hours)
        return LifeWorkReport(
            period_hours=period_hours,
            work=WorkSessionService(self._db).get_summary(
                telegram_id,
                start,
                until=end,
            ),
            lifestyle=LifestyleService(self._db).get_summary(
                telegram_id,
                start,
                until=end,
            ),
        )

    @staticmethod
    def format_report(report: LifeWorkReport) -> str:
        """Render a report as a Persian Telegram message."""
        lifestyle = report.lifestyle
        calorie_text = (
            str(lifestyle.calorie_total)
            if lifestyle.calorie_total is not None
            else "ثبت نشده"
        )
        return (
            f"گزارش {report.period_hours} ساعت گذشته\n"
            f"کار: {_format_minutes(report.work.total_minutes)} در "
            f"{report.work.session_count} نشست؛ "
            f"وظایف باز: {report.work.pending_task_count}\n"
            f"خواب: {lifestyle.sleep_hours:g} ساعت\n"
            f"تغذیه: {lifestyle.meal_count} وعده؛ کالری ثبت‌شده: {calorie_text}\n"
            f"تمرین: {lifestyle.workout_count} جلسه، "
            f"{_format_minutes(lifestyle.workout_minutes)}\n"
            f"ریکاوری: {lifestyle.recovery_count} مورد، "
            f"{_format_minutes(lifestyle.recovery_minutes)}"
        )
