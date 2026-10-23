# Daymark — Minimal Attendance App

A minimal employee attendance app built with HTML, CSS, vanilla JavaScript, Node.js, Express and MongoDB.

## Included
- Secure login with employee/admin roles (bcrypt password hashes, signed JWT in an HttpOnly cookie)
- Server-recorded clock-in and clock-out
- Shift start/end and break configuration by admin
- Attendance history and monthly calendar
- Missed-punch requests and admin approval/rejection
- Employee creation by admin
- Basic login rate limiting and Helmet security headers

## Requirements
- Node.js 18+
- MongoDB Community Server or a MongoDB Atlas connection

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and set your own values. Use a long random `JWT_SECRET`, a strong admin password, and your MongoDB connection string. Do not commit `.env`.
3. Start MongoDB locally (if using local MongoDB).
4. Start the application. If the configured admin account does not exist, it is created from `ADMIN_NAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Existing admin passwords are not overwritten on restart.
5. Run the application:
   ```bash
   npm run dev
   ```
6. Open `http://localhost:3000` and log in with the admin credentials from `.env`.

## Admin workflow
- Use **Team & shifts** to create employee accounts and edit shift times/break minutes.
- Use **Missed punches** to approve or reject requests. Approved corrections update the attendance record.
- Admin accounts are created only through the seed script; public signup is intentionally not available.

## Deploy to Vercel

1. Push this project to a private GitHub repository and import it into Vercel.
2. In the Vercel project settings, set the root directory to `minimal-attendance-app` if the repository contains this folder rather than the app files at its root.
3. Add these environment variables in Vercel for Production (and Preview only if you intend to use a separate test database):
   - `MONGODB_URI`: your MongoDB Atlas connection string. Use a dedicated database user with only the privileges this app needs, and restrict Atlas network access appropriately.
   - `JWT_SECRET`: a newly generated random secret of at least 32 characters.
   - `COOKIE_SECURE`: `true`
   - `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`: the initial admin account details. Choose a new strong password. The account is only created if the email does not already exist; a restart will not reset an existing password.
   - `APP_TIMEZONE`: `Asia/Kolkata` (or your organization's timezone).
   - `NODE_ENV`: `production`
4. Deploy. Vercel detects the Express app from the root `index.js`, serves static files in `public/` through its CDN, and sends application requests to Express. On its first database request, the app connects to MongoDB and creates the initial admin if needed. Sign in as that admin and create each employee account from **Team & shifts**.
5. Test login, clock-in/out and admin review using test accounts before relying on the app for attendance records. Set up Atlas backups and monitor the Vercel deployment logs.

The Vercel function reuses its MongoDB connection while its runtime is warm. Login rate limiting is per function instance, not a shared organization-wide limit; use a shared rate-limit store before exposing the login publicly to significant abuse. Review the hosting plan's current terms and limits for organizational use before selecting a free plan.

## Notes / before production
- This starter uses the `Asia/Kolkata` timezone by default. Keep the frontend and backend timezone configuration aligned if changing it.
- Working duration is elapsed time minus the configured break minutes. For this first version, the configured break is deducted from each completed session; confirm whether that matches your company's policy.
- Attendance calendar shows the logged-in user's own records. Admin overview includes a team check-in table.
- A date with no attendance record is not automatically marked absent; absence rules require company-specific workdays, holidays and leave policies.
- For production, enable HTTPS and set `COOKIE_SECURE=true`, use a strong secrets manager, configure MongoDB network access/backups, add CSRF protection suitable for your deployment, add audit logs for admin changes, and add password reset/invitation flows. Review security and attendance rules before using as an official record system.
- Shift times currently support same-day shifts; overnight shifts need additional logic.
