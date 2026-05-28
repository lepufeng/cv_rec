"""User registration, password authentication, admin bootstrapping."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AuthError, BusinessError, ForbiddenError
from app.core.security import hash_password, verify_password
from app.models.user import User
from app.repositories.user_repo import UserRepository


MIN_PASSWORD_LEN = 6
MIN_USERNAME_LEN = 3


def _validate_credentials(username: str, password: str) -> None:
    if len(username) < MIN_USERNAME_LEN:
        raise BusinessError(
            f"Username must be at least {MIN_USERNAME_LEN} characters",
            code="BUSINESS_USERNAME_TOO_SHORT",
        )
    if len(password) < MIN_PASSWORD_LEN:
        raise BusinessError(
            f"Password must be at least {MIN_PASSWORD_LEN} characters",
            code="BUSINESS_PASSWORD_TOO_SHORT",
        )


class UserService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = UserRepository(session)

    # ---------------- registration ----------------
    async def register_user(self, username: str, password: str) -> User:
        """Register a regular (non-admin) user."""
        _validate_credentials(username, password)
        if await self.repo.by_username(username) is not None:
            raise BusinessError("Username already taken", code="BUSINESS_USERNAME_TAKEN")
        user = User(
            username=username,
            password_hash=hash_password(password),
            is_admin=False,
        )
        await self.repo.add(user)
        return user

    async def bootstrap_admin(self, username: str, password: str) -> User:
        """Create the very first admin. Refuses if any admin already exists."""
        if await self.repo.admin_count() > 0:
            raise ForbiddenError(
                "Admin already exists. Use the regular admin login.",
                code="FORBIDDEN_ADMIN_EXISTS",
            )
        _validate_credentials(username, password)
        if await self.repo.by_username(username) is not None:
            raise BusinessError("Username already taken", code="BUSINESS_USERNAME_TAKEN")
        admin = User(
            username=username,
            password_hash=hash_password(password),
            is_admin=True,
        )
        await self.repo.add(admin)
        return admin

    async def has_any_admin(self) -> bool:
        return (await self.repo.admin_count()) > 0

    # ---------------- authentication ----------------
    async def login(self, username: str, password: str, *, require_admin: bool) -> User:
        user = await self.repo.by_username(username)
        if user is None or not verify_password(password, user.password_hash):
            raise AuthError("Invalid username or password", code="AUTH_INVALID_CREDENTIALS")
        if require_admin and not user.is_admin:
            raise ForbiddenError(
                "This account is not an administrator",
                code="FORBIDDEN_NOT_ADMIN",
            )
        if not require_admin and user.is_admin:
            # Admins must use the admin login portal
            raise ForbiddenError(
                "Admin accounts must sign in from the admin portal",
                code="FORBIDDEN_ADMIN_PORTAL",
            )
        return user

    async def get_by_id(self, user_id: str) -> User | None:
        return await self.repo.get(user_id)
