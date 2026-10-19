#!/usr/bin/env python3
"""Regenerate ../fixtures/itm-golden.json from NTIA's reference ITM.

Usage:  python3 generate.py /path/to/NTIA-itm-checkout

Builds the reference C++ (patched in a temp dir for Linux/macOS: Windows-style
include paths and the __declspec export), runs harness.cpp over a set of test
paths, and records inputs + reference outputs. The test suite
(../itm.test.ts) then checks the TypeScript port against these values.

Test paths: the five official NTIA vectors (p2p.csv + pfls.csv in the NTIA
repo) plus deterministic synthetic terrain covering line-of-sight,
diffraction and troposcatter regimes and every variability mode.
Needs g++ and python3 (stdlib only).
"""
import csv, json, math, os, random, shutil, subprocess, sys, tempfile

if len(sys.argv) != 2:
    sys.exit(__doc__)
ntia = os.path.abspath(sys.argv[1])
here = os.path.dirname(os.path.abspath(__file__))
out_path = os.path.join(here, '..', 'fixtures', 'itm-golden.json')


def build(tmp):
    shutil.copytree(os.path.join(ntia, 'src'), os.path.join(tmp, 'src'))
    shutil.copytree(os.path.join(ntia, 'include'), os.path.join(tmp, 'include'))
    for name in os.listdir(os.path.join(tmp, 'src')):
        p = os.path.join(tmp, 'src', name)
        s = open(p, encoding='utf-8', errors='replace').read().replace('..\\include\\', '../include/')
        open(p, 'w', encoding='utf-8').write(s)
    p = os.path.join(tmp, 'include', 'itm.h')
    s = open(p, encoding='utf-8', errors='replace').read().replace('extern "C" __declspec(dllexport)', 'extern "C"')
    open(p, 'w', encoding='utf-8').write(s)
    shutil.copy(os.path.join(here, 'harness.cpp'), tmp)
    srcs = [os.path.join('src', n) for n in os.listdir(os.path.join(tmp, 'src')) if n.endswith('.cpp')]
    subprocess.check_call(['g++', '-O1', '-std=c++17', '-o', 'harness', 'harness.cpp', *srcs, '-I.'], cwd=tmp)
    return os.path.join(tmp, 'harness')


def smooth_noise(rng, n, octaves, amp, base_wavelength):
    out = [0.0] * n
    for o in range(octaves):
        wl = max(2.0, base_wavelength / (2 ** o))
        a = amp / (2 ** o)
        phase = rng.random() * 1000
        ph2 = rng.random() * 1000
        for i in range(n):
            out[i] += a * (math.sin(i / wl * 2 * math.pi + phase) * 0.6 + math.sin(i / (wl * 1.7) * 2 * math.pi + ph2) * 0.4)
    return out


def synth_profile(rng):
    kind = rng.choice(['flat', 'rolling', 'hilly', 'mountain', 'ridge', 'sea', 'long'])
    if kind == 'long':
        dist = rng.uniform(60e3, 250e3)
    elif kind == 'sea':
        dist = rng.uniform(5e3, 80e3)
    else:
        dist = rng.uniform(0.4e3, 60e3)
    xi = rng.choice([25.0, 30.0, 50.0, 90.0, 100.0, 250.0, 500.0, 1000.0])
    if dist / xi > 600:
        xi = float(math.ceil(dist / 600))
    np_ = max(3, int(dist / xi))
    n = np_ + 1
    base = rng.uniform(0, 1500)
    if kind == 'flat':
        z = [base] * n
    elif kind == 'sea':
        z = [0.0] * n
    elif kind == 'rolling':
        z = [base + v for v in smooth_noise(rng, n, 3, 15, max(4, n / 3))]
    elif kind == 'hilly':
        z = [base + v for v in smooth_noise(rng, n, 4, 80, max(6, n / 2))]
    elif kind == 'mountain':
        z = [base + 300 + v for v in smooth_noise(rng, n, 5, 400, max(8, n / 1.5))]
    elif kind == 'ridge':
        z = [base + v for v in smooth_noise(rng, n, 2, 10, max(4, n / 3))]
        c = rng.randint(n // 4, 3 * n // 4)
        h = rng.uniform(50, 500)
        w = max(1.0, n * rng.uniform(0.01, 0.08))
        z = [zi + h * math.exp(-((i - c) / w) ** 2) for i, zi in enumerate(z)]
    else:  # long
        z = [base + v for v in smooth_noise(rng, n, 4, 120, max(6, n / 2.5))]
    z = [round(max(0.0, v), 1) for v in z]
    return xi, np_, z, kind


def main():
    rng = random.Random(20251019)
    cases = []

    # Official NTIA vectors
    rows = list(csv.DictReader(open(os.path.join(ntia, 'p2p.csv'))))
    pfls = [l.strip().split(',') for l in open(os.path.join(ntia, 'pfls.csv')) if l.strip()]
    for r, p in zip(rows, pfls):
        np_ = int(float(p[0]))
        cases.append(dict(
            label='NTIA p2p.csv vector', hTx=float(r['h_tx__meter']), hRx=float(r['h_rx__meter']), climate=int(r['climate']),
            N0=float(r['N_0']), f=float(r['f__mhz']), pol=int(r['pol']), eps=float(r['epsilon']), sigma=float(r['sigma']),
            mdvar=int(r['mdvar']), time=float(r['time']), location=float(r['location']), situation=float(r['situation']),
            np=np_, xi=float(p[1]), elev=[float(v) for v in p[2:2 + np_ + 1]], expectedDb=float(r['A__db'])))

    for i in range(220):
        xi, np_, z, kind = synth_profile(rng)
        mdvar = rng.choice([0, 1, 2, 3, 3, 3, 10, 11, 12, 13, 20, 21, 22, 23, 30, 31, 32, 33])
        pcts = [1, 5, 10, 22, 50, 50, 50, 77, 90, 95, 99]
        cases.append(dict(
            label='synthetic %s #%d' % (kind, i), hTx=rng.choice([1.0, 2.0, 5.0, 10.0, 30.0, 100.0, 400.0]),
            hRx=rng.choice([1.0, 1.5, 2.0, 5.0, 10.0, 50.0]), climate=rng.randint(1, 7), N0=rng.choice([301.0, 301.0, 250.0, 330.0, 400.0]),
            f=rng.choice([150.0, 433.0, 868.0, 915.0, 915.0, 2400.0, 5800.0]), pol=rng.randint(0, 1),
            eps=rng.choice([4.0, 15.0, 15.0, 25.0, 81.0]), sigma=rng.choice([0.001, 0.005, 0.005, 0.02, 5.0]),
            mdvar=mdvar, time=rng.choice(pcts), location=rng.choice(pcts), situation=rng.choice(pcts),
            np=np_, xi=xi, elev=z))

    inp = [str(len(cases))]
    for c in cases:
        inp.append('%r %r %d %r %r %d %r %r %d %r %r %r %d %r' % (c['hTx'], c['hRx'], c['climate'], c['N0'], c['f'], c['pol'],
                   c['eps'], c['sigma'], c['mdvar'], c['time'], c['location'], c['situation'], c['np'], c['xi']))
        inp.append(' '.join(repr(v) for v in c['elev']))

    with tempfile.TemporaryDirectory() as tmp:
        exe = build(tmp)
        res = subprocess.run([exe], input='\n'.join(inp), capture_output=True, text=True, check=True).stdout.strip().split('\n')

    assert len(res) == len(cases), (len(res), len(cases))
    keys = ['rtn', 'warnings', 'lossDb', 'mode', 'aRefDb', 'aFsDb', 'deltaH', 'dHzn0', 'dHzn1', 'hE0', 'hE1', 'theta0', 'theta1', 'Ns']
    for c, line in zip(cases, res):
        vals = line.split()
        ref = {k: (int(float(v)) if k in ('rtn', 'warnings', 'mode') else float(v)) for k, v in zip(keys, vals)}
        c['ref'] = ref
    with open(out_path, 'w') as f:
        json.dump(cases, f, separators=(',', ':'))
    ok = sum(1 for c in cases if c['ref']['rtn'] in (0, 1))
    print('wrote %d cases (%d computed, %d reference errors) to %s' % (len(cases), ok, len(cases) - ok, os.path.normpath(out_path)))
    modes = {}
    for c in cases:
        if c['ref']['rtn'] in (0, 1):
            modes[c['ref']['mode']] = modes.get(c['ref']['mode'], 0) + 1
    print('propagation modes (1=LOS 2=diffraction 3=troposcatter):', modes)


main()
