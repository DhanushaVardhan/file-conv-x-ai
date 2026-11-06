"""Builds the three demo files for AI Summary and embeds them in public/js/samples.js.

Needs: pip install python-docx openpyxl reportlab
Run:   python3 tools/make_samples.py
"""
import base64, io, json, os, datetime
from docx import Document
from docx.shared import Pt
from openpyxl import Workbook
from openpyxl.styles import Font
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem, PageBreak

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def make_pdf():
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title='Lecture 4: Neural Networks', author='Alembic sample',
                            leftMargin=64, rightMargin=64, topMargin=60, bottomMargin=60)
    ss = getSampleStyleSheet()
    body = ParagraphStyle('b', parent=ss['BodyText'], fontSize=10.5, leading=15)
    h1, h2 = ss['Title'], ss['Heading2']
    def bullets(items):
        return ListFlowable([ListItem(Paragraph(t, body), leftIndent=12) for t in items], bulletType='bullet', start='•', leftIndent=14)
    s = [
        Paragraph('Lecture 4: Neural Networks', h1),
        Paragraph('Introduction to Machine Learning, week 4 notes', body), Spacer(1, 10),
        Paragraph('1. From linear models to neurons', h2),
        Paragraph('A single artificial neuron computes a weighted sum of its inputs, adds a bias, and passes the result through an activation function: y = f(w·x + b). With the identity function this is just linear regression; with the logistic sigmoid it becomes logistic regression.', body),
        Paragraph('Stacking neurons into layers lets the network learn non-linear decision boundaries. A network with one hidden layer of enough units can approximate any continuous function on a bounded region (the universal approximation theorem), although it may need a very large number of units.', body),
        Paragraph('2. Activation functions', h2),
        bullets([
            '<b>Sigmoid</b>: squashes values to (0, 1). Saturates for large inputs, which slows learning (vanishing gradients).',
            '<b>Tanh</b>: output in (−1, 1) and zero-centred, but it also saturates.',
            '<b>ReLU</b>: max(0, z). Cheap and does not saturate for positive inputs; the default choice for hidden layers.',
            '<b>Softmax</b>: turns the output layer into probabilities that sum to 1 for multi-class problems.',
        ]),
        Paragraph('3. Training with backpropagation', h2),
        Paragraph('Training minimises a loss such as cross-entropy. Backpropagation applies the chain rule layer by layer to compute the gradient of the loss with respect to every weight, and gradient descent updates each weight by w ← w − η ∂L/∂w, where η is the learning rate.', body),
        PageBreak(),
        Paragraph('4. Practical tips', h2),
        bullets([
            'Initialise weights randomly (He initialisation for ReLU) so that neurons do not all learn the same thing.',
            'Use mini-batches of 32 to 256 examples; a learning rate of 0.001 with the Adam optimiser is a good starting point.',
            'Watch the validation loss: if it rises while training loss falls, the model is overfitting. Add dropout (p = 0.2 to 0.5), weight decay, or more data.',
            'Normalise inputs to zero mean and unit variance; batch normalisation helps deeper networks train faster.',
        ]),
        Paragraph('5. Worked example', h2),
        Paragraph('On the MNIST handwritten digits dataset (60,000 training images of 28 × 28 pixels), a network with two hidden layers of 128 ReLU units reaches about 98% test accuracy after 10 epochs, compared with about 92% for plain logistic regression.', body),
        Paragraph('6. For next week', h2),
        bullets([
            'Read chapter 6 of the course textbook (Deep feedforward networks).',
            'Problem set 3 is due Friday 13 November at 23:59.',
            'Install PyTorch before the lab session on Tuesday.',
        ]),
    ]
    doc.build(s)
    return buf.getvalue()

def make_docx():
    d = Document()
    d.core_properties.title = 'Campus App: Project Status Report'
    d.add_heading('Campus App: Project Status Report', 0)
    d.add_paragraph('Reporting period: 20 October to 2 November 2026. Prepared by the student developer team for the faculty advisor.')
    d.add_heading('Summary', level=1)
    p = d.add_paragraph('The beta release reached ')
    p.add_run('1,240 active students').bold = True
    p.add_run(' in its second week, up from 410 in week one. Crash-free sessions are at 99.2%. The timetable sync feature is two weeks behind schedule because the registrar API changed its login flow.')
    d.add_heading('Milestones', level=1)
    t = d.add_table(rows=1, cols=3)
    t.style = 'Table Grid'
    for i, h in enumerate(['Milestone', 'Due', 'Status']):
        t.rows[0].cells[i].text = h
    for row in [['Beta launch', '19 Oct', 'Done'], ['Timetable sync', '6 Nov', 'Delayed to 20 Nov'], ['Mess menu voting', '13 Nov', 'On track'], ['Public release', '1 Dec', 'At risk']]:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = v
    d.add_heading('Risks', level=1)
    for r in ['Registrar API login change may need a meeting with the IT office.', 'Only one developer knows the notification service; document it before exams start.', 'Hosting credit runs out on 15 December.']:
        d.add_paragraph(r, style='List Bullet')
    d.add_heading('Action items', level=1)
    for a in ['Asha: email the IT office about API access by 6 November.', 'Ravi: write setup notes for the notification service by 10 November.', 'Meera: apply for the cloud credits programme by 20 November.', 'Team: run a usability test with 10 first-year students before public release.']:
        d.add_paragraph(a, style='List Number')
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()

def make_xlsx():
    wb = Workbook()
    ws = wb.active
    ws.title = 'Sales 2026'
    ws.append(['Month', 'Region', 'Units sold', 'Revenue (INR)', 'Returns'])
    for c in ws[1]:
        c.font = Font(bold=True)
    regions = {'North': (420, 1.00), 'South': (510, 1.08), 'West': (380, 0.95), 'East': (300, 0.90)}
    import math
    for m in range(1, 11):
        for i, (r, (base, k)) in enumerate(regions.items()):
            season = 1 + 0.18 * math.sin((m - 3) / 12 * 2 * math.pi)
            units = int(base * k * season + (m * 7) + (i * 11) % 23)
            if r == 'East' and m == 7:
                units = int(units * 1.6)  # a festival promotion spike
            ws.append([datetime.date(2026, m, 1), r, units, units * 1499, int(units * (0.03 + 0.01 * (i % 2)))])
    for row in ws.iter_rows(min_row=2, min_col=1, max_col=1):
        row[0].number_format = 'mmm yyyy'
    ws2 = wb.create_sheet('Products')
    ws2.append(['Product', 'Category', 'Price (INR)', 'Stock', 'Rating'])
    for c in ws2[1]:
        c.font = Font(bold=True)
    for row in [['Aurora earbuds', 'Audio', 1499, 820, 4.4], ['Pulse smartwatch', 'Wearables', 3999, 210, 4.1], ['Volt power bank', 'Accessories', 999, 1430, 4.6], ['Echo speaker', 'Audio', 2499, 95, 3.8], ['Glide stylus', 'Accessories', 799, 640, 4.2]]:
        ws2.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()

files = [
    ('pdf', 'lecture-4-neural-networks.pdf', 'application/pdf', make_pdf()),
    ('docx', 'campus-app-status-report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', make_docx()),
    ('xlsx', 'sales-2026.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', make_xlsx()),
]
out = ['/* Generated by tools/make_samples.py: demo files for AI Summary. */', '(function () {', "  'use strict';", '  const A = (window.Alembic = window.Alembic || {});', '  A.SAMPLES = {']
for key, name, mime, data in files:
    out.append(f"    {key}: {{ name: {json.dumps(name)}, mime: {json.dumps(mime)}, b64: '{base64.b64encode(data).decode()}' }},")
    print(f'{name}: {len(data)} bytes')
out += ['  };', '})();', '']
open(os.path.join(ROOT, 'public', 'js', 'samples.js'), 'w').write('\n'.join(out))
os.makedirs(os.path.join(ROOT, 'test', 'fixtures'), exist_ok=True)
for key, name, mime, data in files:
    open(os.path.join(ROOT, 'test', 'fixtures', name), 'wb').write(data)
print('wrote public/js/samples.js')
