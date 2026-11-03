"""ดึงข้อมูลจาก Garmin Connect แล้วส่งเข้าชีตลดพุง (รันบน GitHub Actions ทุกเช้า)

ต้องมี GitHub Secrets: GARMIN_EMAIL, GARMIN_PASSWORD, LP_KEY (รหัสแอปลดพุง)
token ล็อกอิน Garmin เก็บไว้ใน Apps Script (Script Properties) ไม่เก็บใน repo เพราะ repo เป็นสาธารณะ
log ของ Actions ใครก็เปิดดูได้ → พิมพ์แค่จำนวน ห้ามพิมพ์ค่าสุขภาพ/รหัส
"""
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import requests
from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectTooManyRequestsError,
)

TZ = ZoneInfo("Asia/Bangkok")
API = os.environ.get("LP_API", "")
KEY = os.environ.get("LP_KEY", "")
DAYS = max(1, min(60, int(os.environ.get("DAYS") or 3)))


def die(msg):
    print("::error::" + msg)
    sys.exit(1)


def call(fn, *args):
    """เรียก Apps Script แบบเดียวกับหน้าเว็บ: POST {fn, args, k} → {ok, result}"""
    body = json.dumps({"fn": fn, "args": list(args), "k": KEY})
    for i in range(3):
        try:
            r = requests.post(API, data=body, headers={"Content-Type": "text/plain"}, timeout=120)
            j = r.json()
            if not j.get("ok"):
                die(f"Apps Script ตอบ error ที่ {fn}: {j.get('error')}")
            return j.get("result")
        except (requests.RequestException, ValueError) as e:
            if i == 2:
                die(f"ส่งเข้า Apps Script ไม่ได้ ({fn}): {type(e).__name__}")
            time.sleep(5 * (i + 1))


def safe(f, *a):
    try:
        return f(*a)
    except GarminConnectTooManyRequestsError:
        raise
    except Exception:
        return None


def num(x, nd=0):
    try:
        v = float(x)
        return round(v, nd) if nd else int(round(v))
    except (TypeError, ValueError):
        return None


def hhmm(ms):
    if not ms:
        return None
    return datetime.fromtimestamp(ms / 1000, timezone.utc).astimezone(TZ).strftime("%H:%M")


def day_data(api, d):
    o = {"date": d}
    s = safe(api.get_user_summary, d) or {}
    o["steps"] = num(s.get("totalSteps"))
    o["rhr"] = num(s.get("restingHeartRate"))
    o["bb_high"] = num(s.get("bodyBatteryHighestValue"))
    o["bb_low"] = num(s.get("bodyBatteryLowestValue"))
    o["bb_wake"] = num(s.get("bodyBatteryAtWakeTime"))
    st = num(s.get("averageStressLevel"))
    o["stress"] = st if st is not None and st >= 0 else None   # -1/-2 = ไม่มีข้อมูล
    sm = num(s.get("maxStressLevel"))
    o["stress_max"] = sm if sm is not None and sm >= 0 else None
    o["kcal_active"] = num(s.get("activeKilocalories"))
    o["kcal_total"] = num(s.get("totalKilocalories"))
    mi, vi = s.get("moderateIntensityMinutes"), s.get("vigorousIntensityMinutes")
    if mi is not None or vi is not None:
        o["int_min"] = (mi or 0) + 2 * (vi or 0)
    o["floors"] = num(s.get("floorsAscended"))

    sl = (safe(api.get_sleep_data, d) or {}).get("dailySleepDTO") or {}
    if sl.get("sleepTimeSeconds"):
        o["sleep_min"] = round(sl["sleepTimeSeconds"] / 60)
        o["sleep_from"] = hhmm(sl.get("sleepStartTimestampGMT"))
        o["sleep_to"] = hhmm(sl.get("sleepEndTimestampGMT"))
        for k, f in (("sleep_deep", "deepSleepSeconds"), ("sleep_rem", "remSleepSeconds"),
                     ("sleep_light", "lightSleepSeconds"), ("sleep_awake", "awakeSleepSeconds")):
            if sl.get(f) is not None:
                o[k] = round(sl[f] / 60)
        o["sleep_score"] = num(((sl.get("sleepScores") or {}).get("overall") or {}).get("value"))
        o["spo2"] = num(sl.get("averageSpO2Value") or sl.get("avgSpO2"))
        o["resp"] = num(sl.get("averageRespirationValue"), 1)

    h = ((safe(api.get_hrv_data, d) or {}).get("hrvSummary")) or {}
    o["hrv"] = num(h.get("lastNightAvg"))
    o["hrv_week"] = num(h.get("weeklyAvg"))
    o["hrv_status"] = h.get("status")

    tr = safe(api.get_training_readiness, d)
    if isinstance(tr, list) and tr:
        o["readiness"] = num(max(tr, key=lambda x: x.get("timestamp") or "").get("score"))

    mm = safe(api.get_max_metrics, d)
    mm = mm[0] if isinstance(mm, list) and mm else mm
    if isinstance(mm, dict):
        o["vo2max"] = num((mm.get("generic") or {}).get("vo2MaxPreciseValue") or (mm.get("generic") or {}).get("vo2MaxValue"), 1)

    return {k: v for k, v in o.items() if v is not None}


def acts(api, start, end):
    out = []
    for a in safe(api.get_activities_by_date, start, end) or []:
        try:
            s = datetime.strptime(a["startTimeGMT"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            e = s + timedelta(seconds=float(a.get("duration") or 0))
        except (KeyError, ValueError, TypeError):
            continue
        out.append({"start": s.strftime("%Y-%m-%dT%H:%M:%SZ"), "end": e.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "type": ((a.get("activityType") or {}).get("typeKey") or "").replace("_", " ")})
    return out


def main():
    if not API or not KEY:
        die("ยังไม่ได้ใส่ Secret LP_KEY (รหัสแอปลดพุง)")
    email, pw = os.environ.get("GARMIN_EMAIL", ""), os.environ.get("GARMIN_PASSWORD", "")
    tokens = call("garminTokens") or None

    def mfa():
        code = os.environ.get("MFA_CODE", "").strip()
        if not code:
            die("บัญชี Garmin เปิดยืนยันตัวตน 2 ชั้นอยู่ — ปิดชั่วคราวใน Garmin Connect แล้วกด Run workflow ใหม่ (ล็อกอินครั้งแรกครั้งเดียว)")
        return code

    api = Garmin(email or None, pw or None, prompt_mfa=mfa)
    try:
        api.login(tokens)
    except GarminConnectAuthenticationError:
        die("ล็อกอิน Garmin ไม่ผ่าน — เช็ก Secret GARMIN_EMAIL / GARMIN_PASSWORD")
    except GarminConnectTooManyRequestsError:
        die("Garmin บล็อกการล็อกอินชั่วคราว (429) — รอสักชั่วโมงแล้วลองใหม่")
    except Exception as e:
        die(f"ล็อกอิน Garmin ไม่ได้: {type(e).__name__} (Garmin อาจเปลี่ยนระบบ รออัปเดตไลบรารี)")
    print("ล็อกอิน Garmin สำเร็จ" + (" (ใช้ token เดิม)" if tokens else " (ล็อกอินใหม่)"))

    today = datetime.now(TZ).date()
    dates = [(today - timedelta(days=i)).isoformat() for i in range(DAYS - 1, -1, -1)]
    days = []
    try:
        for d in dates:
            days.append(day_data(api, d))
            time.sleep(0.3)
        ac = acts(api, dates[0], dates[-1])
    except GarminConnectTooManyRequestsError:
        die("Garmin จำกัดจำนวนครั้ง (429) — ลองใหม่ทีหลัง")

    try:
        new_tokens = api.client.dumps()
    except Exception:
        new_tokens = None

    r = call("importGarmin", {"days": days, "acts": ac, "tokens": new_tokens})
    print(f"ส่งเข้าชีตแล้ว: {r.get('days')} วัน · ออกกำลัง {r.get('acts')} รายการ (ใหม่ {r.get('added')})")
    got = sorted({k for d in days for k in d if k != "date"})
    print("ชนิดข้อมูลที่ได้: " + ", ".join(got))


if __name__ == "__main__":
    main()
