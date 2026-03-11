import urllib.request
import re

urls = [
    'https://shotnavi.jp/world/764/12/gc_11.htm',
    'https://shotnavi.jp/world/764/12/gc_23.htm'
]

for url in urls:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    html = urllib.request.urlopen(req).read().decode('utf-8')
    print('URL:', url)

    # find all sub-course links within the course data div
    links = re.findall(r'<a[^>]+href="([^"]+)"[^>]*>([^<]+)</a>', html)
    for href, text in links:
        if 'gc_' in href and '_' in href:
            if not href.startswith('http'):
                full_href = 'https://shotnavi.jp/world/764/12/' + href.split('/')[-1]
            else:
                full_href = href
            print('  -> text:', text.strip(), 'href:', full_href)
            try:
                sub_req = urllib.request.Request(full_href, headers={'User-Agent': 'Mozilla/5.0'})
                sub_html = urllib.request.urlopen(sub_req).read().decode('utf-8')
                par_row = re.search(r'(<tr[^>]*>.*?PAR.*?</tr>)', sub_html, re.IGNORECASE | re.DOTALL)
                if par_row:
                    cols = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', par_row.group(1), re.IGNORECASE | re.DOTALL)
                    clean = [re.sub(r'<[^>]+>', '', c).strip() for c in cols]
                    print('     PAR:', clean)
            except Exception as e:
                print('     Fail:', e)
