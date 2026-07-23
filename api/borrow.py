"""
Vercel Serverless Function for handling book borrowing with theme event rewards.
Handles:
1. Normal borrowing record writing to Supabase
2. Active theme event querying
3. Keyword matching and deduplication
4. Google Sheets reward logging
"""

import json
import os
from datetime import datetime
from typing import Optional
import gspread
from google.oauth2.service_account import Credentials

# Import Supabase client
from supabase import create_client, Client

# Initialize Supabase
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Google Sheets configuration
GOOGLE_SHEETS_CREDENTIALS_JSON = os.environ.get("GOOGLE_SHEETS_CREDENTIALS", "{}")
GOOGLE_SHEETS_SPREADSHEET_ID = os.environ.get("GOOGLE_SHEETS_SPREADSHEET_ID", "")


def get_google_sheets_client():
    """Initialize Google Sheets client from service account credentials."""
    try:
        creds_dict = json.loads(GOOGLE_SHEETS_CREDENTIALS_JSON)
        credentials = Credentials.from_service_account_info(
            creds_dict,
            scopes=["https://www.googleapis.com/auth/spreadsheets"],
        )
        return gspread.authorize(credentials)
    except Exception as e:
        print(f"Error initializing Google Sheets client: {e}")
        return None


def get_active_theme_events(current_date: str) -> list:
    """Query active theme events for the current date."""
    try:
        response = supabase.table("theme_events").select("*").execute()
        events = response.data or []
        
        # Filter events where current_date is between start_date and end_date
        active_events = [
            event for event in events
            if event["start_date"] <= current_date <= event["end_date"]
        ]
        return active_events
    except Exception as e:
        print(f"Error fetching active theme events: {e}")
        return []


def matches_keywords(book_title: str, keywords: Optional[str]) -> bool:
    """Check if book title matches the event keywords."""
    if not keywords or keywords.strip() == "" or keywords.strip() == "*":
        return True  # No keyword restriction
    
    keyword_list = [k.strip().lower() for k in keywords.split(",") if k.strip()]
    title_lower = book_title.lower()
    return any(keyword in title_lower for keyword in keyword_list)


def get_unique_book_count(student_id: str, event: dict) -> int:
    """
    Calculate the number of unique books borrowed by the student during the event period.
    Deduplication is based on barcode (book ID).
    """
    try:
        # Query borrowing records for the student during the event period
        response = supabase.table("books").select("barcode, title, borrowed_by, borrowed_at").execute()
        all_books = response.data or []
        
        # Filter for this student during the event period
        student_borrowings = [
            book for book in all_books
            if book["borrowed_by"] == student_id
            and event["start_date"] <= (book["borrowed_at"] or "")[:10] <= event["end_date"]
        ]
        
        # Filter for matching keywords
        matching_books = [
            book for book in student_borrowings
            if matches_keywords(book["title"], event["keywords"])
        ]
        
        # Deduplicate by barcode
        unique_barcodes = set(book["barcode"] for book in matching_books)
        return len(unique_barcodes)
    except Exception as e:
        print(f"Error calculating unique book count: {e}")
        return 0


def log_reward_to_google_sheets(
    student_id: str,
    points: int,
    event_name: str,
    timestamp: str
) -> bool:
    """
    Log the reward to Google Sheets in the 'Logs' worksheet.
    Appends a row with: Time, Student ID, Points, Reason, Teacher
    """
    try:
        client = get_google_sheets_client()
        if not client or not GOOGLE_SHEETS_SPREADSHEET_ID:
            print("Google Sheets client or spreadsheet ID not configured")
            return False
        
        spreadsheet = client.open_by_key(GOOGLE_SHEETS_SPREADSHEET_ID)
        
        # Get or create the 'Logs' worksheet
        try:
            worksheet = spreadsheet.worksheet("Logs")
        except gspread.exceptions.WorksheetNotFound:
            worksheet = spreadsheet.add_worksheet(title="Logs", rows=1000, cols=5)
            # Add header row
            worksheet.append_row(["Time", "Student ID", "Points", "Reason", "Teacher"])
        
        # Prepare the row to append
        reason = f"圖書館活動-{event_name}"
        row = [timestamp, student_id, str(points), reason, "青山圖書列車"]
        
        # Append to the worksheet
        worksheet.append_row(row)
        return True
    except Exception as e:
        print(f"Error logging reward to Google Sheets: {e}")
        return False


def handler(request):
    """Main handler for the borrow endpoint."""
    if request.method != "POST":
        return {"statusCode": 405, "body": json.dumps({"error": "Method not allowed"})}
    
    try:
        body = json.loads(request.body) if isinstance(request.body, str) else request.body
        barcode = body.get("barcode", "").strip()
        student_id = body.get("student_id", "").strip()
        
        if not barcode or not student_id:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "Missing barcode or student_id"}),
            }
        
        # Step 1: Write normal borrowing record to Supabase
        try:
            book_response = supabase.table("books").select("title, status").eq("barcode", barcode).execute()
            book = book_response.data[0] if book_response.data else None
            
            if not book:
                return {
                    "statusCode": 404,
                    "body": json.dumps({"error": "Book not found"}),
                }
            
            if book["status"] != "available":
                return {
                    "statusCode": 400,
                    "body": json.dumps({"error": "Book is not available"}),
                }
            
            # Update book status to borrowed
            supabase.table("books").update({
                "status": "borrowed",
                "borrowed_by": student_id,
                "borrowed_at": datetime.utcnow().isoformat(),
            }).eq("barcode", barcode).execute()
        except Exception as e:
            print(f"Error updating book status: {e}")
            return {
                "statusCode": 500,
                "body": json.dumps({"error": "Failed to update book status"}),
            }
        
        # Step 2: Query active theme events
        current_date = datetime.utcnow().date().isoformat()
        active_events = get_active_theme_events(current_date)
        
        if not active_events:
            return {
                "statusCode": 200,
                "body": json.dumps({
                    "ok": True,
                    "message": "Book borrowed successfully",
                    "rewards": [],
                }),
            }
        
        # Step 3-5: Process each active event
        rewards = []
        timestamp = datetime.utcnow().strftime("%Y/%m/%d %H:%M")
        
        for event in active_events:
            # Skip if keywords don't match
            if not matches_keywords(book["title"], event["keywords"]):
                continue
            
            # Calculate unique book count
            unique_count = get_unique_book_count(student_id, event)
            
            # Check if reward is achieved
            target_count = event["target_count"]
            if unique_count > 0 and unique_count % target_count == 0:
                reward_points = event["reward_points"]
                event_name = event["event_name"]
                
                # Log to Google Sheets
                success = log_reward_to_google_sheets(
                    student_id,
                    reward_points,
                    event_name,
                    timestamp
                )
                
                if success:
                    rewards.append({
                        "event_name": event_name,
                        "points": reward_points,
                        "unique_count": unique_count,
                        "target_count": target_count,
                    })
            else:
                # Not yet achieved, but provide progress
                if unique_count > 0:
                    rewards.append({
                        "event_name": event["event_name"],
                        "progress": unique_count,
                        "target_count": target_count,
                        "message": f"主題活動進度：目前已收集 {unique_count} 本，加油！",
                    })
        
        return {
            "statusCode": 200,
            "body": json.dumps({
                "ok": True,
                "message": "Book borrowed successfully",
                "rewards": rewards,
            }),
        }
    except Exception as e:
        print(f"Error in borrow handler: {e}")
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)}),
        }
