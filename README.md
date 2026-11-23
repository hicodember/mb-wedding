# Mackenzie & Brandon wedding app: going live

Guests open **https://wedding.codember.co**. The couple manages everything at **https://wedding.codember.co/admin.html**.

## What's in this folder

| Folder | What it is |
|---|---|
| `site/` | The website. This whole folder gets uploaded to Cloudflare Pages. |
| `site/config.js` | The only file you edit: Supabase keys, wedding details, schedule, hunt, quiz, wedding party, Venmo and Cash App. |
| `supabase/schema.sql` | Sets up the database, security rules and photo storage. Run it once. |
| `kit/guest-list-template.csv` | Example guest list. Fill in the real one in the same format. |
| `kit/qr-wedding.codember.co.png` | QR code for save the dates and table cards. It opens wedding.codember.co. |
| `tools/download_all.py` | Downloads every photo, video and wish after the wedding. |

## 1. Supabase (on Mackenzie's card)

1. Go to supabase.com, sign in, and create a **new organization** named "Mackenzie & Brandon Wedding". Add Mackenzie's card under that organization's billing. Your Codember organization stays separate.
2. Create a project in it: name `mb-wedding`, region **East US** or **Central US**, and save the database password somewhere safe.
3. **SQL Editor > New query**: paste all of `supabase/schema.sql`, then edit the last line with the real admin emails (Mackenzie, Brandon, info@codember.co), remove the `--` at the start of that line, and click **Run**.
4. **Authentication > URL Configuration**: set Site URL to `https://wedding.codember.co` and add `https://wedding.codember.co/admin.html` under Redirect URLs.
5. Optional: **Authentication > Emails > SMTP Settings**: use your Resend SMTP so sign-in emails come from info@codember.co. The built-in sender only allows a few emails an hour, which is enough for 2 or 3 admins.
6. **Project Settings > API Keys**: open "Legacy API keys" and copy the Project URL and the **anon public** key into `site/config.js`. Never use the service_role key in the website.

### When to upgrade to Pro

- RSVPs, the quiz and wishes work on the Free plan. Free projects pause after about a week with no visits. If that happens, click **Restore** in the dashboard and it's back in a few minutes.
- **About a week before the wedding**, upgrade the organization to **Pro** (about $25 a month). Free only allows 1 GB of storage and 50 MB per file, so 1-minute videos won't fit.
- After upgrading, go to **Storage > Settings** and set the upload file size limit to **200 MB**.

## 2. Fill in config.js

Fill in everything marked with `''`. Anything left blank keeps its [bracket] placeholder in the app.

- `moments`: set each `start` to the real date and time. Use `-05:00` for Texas in summer and `-06:00` in winter. The app uses these to know what's "happening now" and which part of the day each photo belongs to.
- `quiz`: add their real questions. `correct` counts from 0: the first answer is 0, the second is 1, and so on.
- `venmo` / `cashapp`: leave one blank to hide that button.

## 3. Cloudflare Pages

1. In Cloudflare: **Workers & Pages > Create > Pages > Upload assets**. Name the project `mb-wedding`.
2. Drag in the **contents** of the `site/` folder: index.html, admin.html, config.js, live.js, _headers and images. Click **Deploy**.
3. In the project, go to **Custom domains > Set up a domain**, enter `wedding.codember.co` and confirm. codember.co is already on Cloudflare, so DNS is added for you. It's usually live within a few minutes.
4. To change anything later, edit the files and deploy the folder again under **Deployments > Create deployment**.

## 4. Set up the dashboard (admin.html)

1. Open `https://wedding.codember.co/admin.html`, enter an admin email and click the link in the email.
2. **Guest list**: upload the CSV (same columns as the template). People on one invitation share the same `invitation` value. Put `yes` under `plus_one` for people who get a plus one.
3. **Quiz**: click **Save answer key**.
4. **Settings**: set when photos open (the morning of the wedding) and when the quiz leaderboard shows (during the reception).

## 5. Test before sending the link

- [ ] On your phone, open the site, type a name, and RSVP as someone from the test list. Check that it shows up under RSVPs in the dashboard.
- [ ] Record and send a video wish. It should show up under Video wishes.
- [ ] In Settings, tap **Open photos right now**. Upload a photo and a short video, and do one scavenger hunt mission. Check the gallery and the dashboard's Photos tab. Hide one photo and confirm guests can't see it anymore.
- [ ] Set the unlock time back to the morning of the wedding.
- [ ] Remove test guests and test RSVPs, and delete test photos in **Supabase > Storage**.

## 6. After the wedding

1. Run `python tools/download_all.py <project url> <service_role key>`. It saves every photo, video and wish into `wedding-download/`.
2. Give the couple the folder, for example on a shared drive.
3. In the Supabase organization's billing, downgrade to Free or delete the project.

## Notes

- The wedding-day lock is enforced by the database, not just the app. Nobody can upload to the gallery before the unlock time, even by calling the server directly.
- Guests only see visible photos, and only after the unlock time. RSVPs, the guest list, video wishes and gifts are only visible to admins.
- Guests can only RSVP for people on their own invitation, and searching needs at least 3 letters, so the full guest list can't be browsed.
- The Venmo and Cash App buttons open those apps with the amount filled in. The dashboard shows who tapped, but check Venmo or Cash App to confirm the money arrived.
