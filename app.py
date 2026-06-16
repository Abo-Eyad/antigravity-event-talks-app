import os
import time
import hashlib
import requests
import feedparser
from bs4 import BeautifulSoup
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

# Cache configuration
FEED_URL = "https://docs.cloud.google.com/feeds/bigquery-release-notes.xml"
cache = {
    "data": None,
    "last_fetched": 0,
    "ttl": 300  # Cache for 5 minutes
}

def parse_entry_content(entry_title, entry_link, entry_updated, html_content):
    """
    Parses the HTML content of a feed entry using BeautifulSoup
    to extract individual updates by their <h3> headers.
    """
    soup = BeautifulSoup(html_content, 'html.parser')
    updates = []
    
    headers = soup.find_all('h3')
    
    # Fallback if no h3 tags are found in the content
    if not headers:
        text_content = soup.get_text().strip()
        unique_id = hashlib.md5(f"{entry_title}_{text_content[:50]}".encode('utf-8')).hexdigest()
        updates.append({
            'id': unique_id,
            'date': entry_title,
            'iso_date': entry_updated,
            'type': 'Update',
            'content': str(html_content),
            'text_content': text_content,
            'link': entry_link
        })
        return updates
        
    for header in headers:
        update_type = header.get_text().strip()
        
        # Gather all sibling elements until the next h3
        details = []
        sibling = header.next_sibling
        while sibling and sibling.name != 'h3':
            if sibling.name or (isinstance(sibling, str) and sibling.strip()):
                details.append(sibling)
            sibling = sibling.next_sibling
            
        # Re-construct HTML for this update's detail
        detail_soup = BeautifulSoup('', 'html.parser')
        for item in details:
            detail_soup.append(item)
            
        # Ensure external links open in a new tab
        for a_tag in detail_soup.find_all('a'):
            a_tag['target'] = '_blank'
            a_tag['rel'] = 'noopener noreferrer'
            
        html_str = str(detail_soup).strip()
        text_str = detail_soup.get_text().strip()
        
        # Generate a unique ID based on date, type and content hash
        content_hash = hashlib.md5(text_str.encode('utf-8')).hexdigest()
        unique_id = f"{entry_updated.split('T')[0]}_{update_type.lower()}_{content_hash[:8]}"
        
        updates.append({
            'id': unique_id,
            'date': entry_title,
            'iso_date': entry_updated,
            'type': update_type,
            'content': html_str,
            'text_content': text_str,
            'link': entry_link
        })
        
    return updates

def fetch_and_parse_feed(force_refresh=False):
    """
    Fetches the RSS/Atom feed, parses it, and caches the result.
    If force_refresh is True, it ignores the cache TTL.
    """
    now = time.time()
    
    # Return cache if valid and not force refreshing
    if not force_refresh and cache["data"] and (now - cache["last_fetched"] < cache["ttl"]):
        return cache["data"], cache["last_fetched"], False
        
    try:
        response = requests.get(FEED_URL, timeout=15)
        response.raise_for_status()
        
        feed = feedparser.parse(response.content)
        all_updates = []
        
        for entry in feed.entries:
            title = entry.get("title", "")
            link = entry.get("link", "")
            updated = entry.get("updated", "")
            
            # Content can be in the 'content' field (as a list) or 'summary'
            content_val = ""
            if 'content' in entry and len(entry.content) > 0:
                content_val = entry.content[0].value
            else:
                content_val = entry.get("summary", "")
                
            entry_updates = parse_entry_content(title, link, updated, content_val)
            all_updates.extend(entry_updates)
            
        # Cache the parsed updates
        cache["data"] = all_updates
        cache["last_fetched"] = now
        return all_updates, now, True
        
    except Exception as e:
        print(f"Error fetching feed: {e}")
        # Return stale cache if available, otherwise propagate the error
        if cache["data"]:
            return cache["data"], cache["last_fetched"], True
        raise e

@app.route('/')
def index():
    """Renders the main dashboard page."""
    return render_template('index.html')

@app.route('/api/releases')
def get_releases():
    """
    API endpoint that returns the list of BigQuery release notes.
    Accepts an optional ?refresh=true query parameter to force feed refresh.
    """
    force_refresh = request.args.get('refresh', 'false').lower() == 'true'
    
    try:
        updates, last_fetched_time, was_refreshed = fetch_and_parse_feed(force_refresh)
        
        # Calculate human-readable last updated time
        elapsed = int(time.time() - last_fetched_time)
        if elapsed < 60:
            last_updated_str = "just now"
        elif elapsed < 3600:
            last_updated_str = f"{elapsed // 60}m ago"
        else:
            last_updated_str = f"{elapsed // 3600}h ago"
            
        return jsonify({
            'success': True,
            'updates': updates,
            'last_fetched_epoch': last_fetched_time,
            'last_updated_str': last_updated_str,
            'cache_hit': not was_refreshed
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    # Run in debug mode locally
    app.run(host='127.0.0.1', port=5000, debug=True)
