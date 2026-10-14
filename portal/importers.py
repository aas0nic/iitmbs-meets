"""Read attendee lists (name + email) from CSV or Excel (.xlsx) uploads using only the standard library."""
import csv
import io
import re
import zipfile
from xml.etree import ElementTree as ET

from .api.common import EMAIL_RE

MAX_BYTES = 2 * 1024 * 1024        # upload cap
MAX_XML_BYTES = 20 * 1024 * 1024   # decompressed cap per sheet part (zip-bomb guard)
MAX_ROWS = 2000
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


class ImportError_(ValueError):
    pass


def read_attendees(filename, data):
    """Return (attendees, skipped) where attendees = [{'name', 'email'}], de-duplicated by email."""
    if len(data) > MAX_BYTES:
        raise ImportError_('File is too large (max 2 MB).')
    ext = filename.lower().rsplit('.', 1)[-1] if '.' in filename else ''
    if ext == 'csv':
        table = _csv_rows(data)
    elif ext in ('xlsx', 'xlsm'):
        table = _xlsx_rows(data)
    elif ext == 'xls':
        raise ImportError_('Old .xls files are not supported. Save the sheet as .xlsx or .csv and try again.')
    else:
        raise ImportError_('Upload a .csv or .xlsx file.')
    return _to_attendees(table[:MAX_ROWS + 1])


def _csv_rows(data):
    text = data.decode('utf-8-sig', errors='replace')
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=',;\t')
    except csv.Error:
        dialect = csv.excel
    return [row for row in csv.reader(io.StringIO(text), dialect)]


def _col_index(ref):
    letters = re.match(r'[A-Z]+', ref).group()
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _xlsx_rows(data):
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ImportError_('That file is not a valid Excel workbook.')
    names = z.namelist()

    def read(name):
        info = z.getinfo(name)
        if info.file_size > MAX_XML_BYTES:
            raise ImportError_('The workbook is too large to import.')
        return z.read(name)

    shared = []
    if 'xl/sharedStrings.xml' in names:
        for si in ET.fromstring(read('xl/sharedStrings.xml')).iter(f'{NS}si'):
            shared.append(''.join(t.text or '' for t in si.iter(f'{NS}t')))
    sheets = sorted(n for n in names if re.match(r'xl/worksheets/sheet\d+\.xml$', n))
    if not sheets:
        raise ImportError_('No worksheet found in the workbook.')
    sheet = 'xl/worksheets/sheet1.xml' if 'xl/worksheets/sheet1.xml' in sheets else sheets[0]

    table = []
    for row in ET.fromstring(read(sheet)).iter(f'{NS}row'):
        cells = {}
        for c in row.iter(f'{NS}c'):
            ref, kind, v = c.get('r', 'A1'), c.get('t'), c.find(f'{NS}v')
            if kind == 's' and v is not None:
                val = shared[int(v.text)] if v.text and int(v.text) < len(shared) else ''
            elif kind == 'inlineStr':
                val = ''.join(t.text or '' for t in c.iter(f'{NS}t'))
            else:
                val = v.text if v is not None and v.text else ''
            cells[_col_index(ref)] = val
        if cells:
            table.append([cells.get(i, '') for i in range(max(cells) + 1)])
        if len(table) > MAX_ROWS + 1:
            break
    return table


def _to_attendees(table):
    rows = [[str(c).strip() for c in r] for r in table if any(str(c).strip() for c in r)]
    if not rows:
        return [], 0
    header = [c.lower() for c in rows[0]]
    name_col = next((i for i, h in enumerate(header) if 'name' in h), None)
    email_col = next((i for i, h in enumerate(header) if 'mail' in h), None)
    if name_col is not None or email_col is not None:
        body = rows[1:]
    else:
        body = rows
    if email_col is None:
        # Pick the column where most values look like email addresses.
        width = max(len(r) for r in body)
        scores = [sum(1 for r in body if i < len(r) and EMAIL_RE.match(r[i])) for i in range(width)]
        email_col = max(range(width), key=lambda i: scores[i]) if width else 0
    if name_col is None:
        name_col = next((i for i in range(max(len(r) for r in body)) if i != email_col), None)

    seen, out, skipped = set(), [], 0
    for r in body:
        email = r[email_col].lower() if email_col < len(r) else ''
        name = r[name_col] if name_col is not None and name_col < len(r) else ''
        if not EMAIL_RE.match(email) or not name or email in seen:
            skipped += 1
            continue
        seen.add(email)
        out.append({'name': name[:120], 'email': email[:200]})
    return out, skipped
