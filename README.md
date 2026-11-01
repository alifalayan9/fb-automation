
# AZIM AUTOMATION

Facebook Multi-Page Video and Reels Publishing System.

## Features

- Facebook Page Connection
- Multiple Page Selection
- Normal Facebook Video Publishing
- Facebook Reels Publishing
- Video Title and Description
- Scheduled Publishing
- Country Exclusion
- Region Exclusion
- Page-wise Publishing Report

## Backend

Render Backend:

https://azim-automation-api.onrender.com

## Frontend

GitHub Pages:

https://alifalayan9.github.io/fb-automation/

## Required Environment Variables

Set these in Render:

- META_APP_ID
- META_APP_SECRET
- META_REDIRECT_URI
- META_CONFIG_ID
- FRONTEND_ORIGIN
- FRONTEND_URL
- META_GRAPH_VERSION

## Meta Permissions

- pages_show_list
- pages_read_engagement
- pages_manage_posts

## Important

Page access tokens and Meta App Secret must remain on the backend.

Do not upload secrets to GitHub.

Publishing depends on Meta permissions, Page access,
App Mode, API support and App Review requirements.

Country and region restrictions are subject to
Meta API support. District restrictions require
Meta-supported region IDs.

This is an initial integration. Persistent encrypted
session storage and production hardening are still
required before regular production use.
