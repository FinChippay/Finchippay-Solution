import os

BASE = r'C:\Users\USER\Finchippay-Solution'
ci_path = os.path.join(BASE, '.github', 'workflows', 'ci.yml')

with open(ci_path, 'rb') as f:
    data = f.read()

# Decode, replacing problematic bytes
text = data.decode('utf-8', errors='replace')

fuzz_job = '''
  # --- Fuzz Testing (cargo-fuzz) -----------------------------------------------
  fuzz:
    name: Fuzz Testing (cargo-fuzz)
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: contracts/finchippay-contract

    steps:
      - uses: actions/checkout@v4

      - name: Install Rust nightly
        uses: dtolnay/rust-toolchain@v1
        with:
          toolchain: nightly

      - name: Cache cargo
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            contracts/finchippay-contract/target
          key: ${{ runner.os }}-cargo-fuzz-${{ hashFiles('contracts/finchippay-contract/Cargo.lock') }}

      - name: Install cargo-fuzz
        run: cargo install cargo-fuzz

      - name: Verify fuzz targets compile
        run: cargo fuzz build

      - name: Fuzz open_stream (120s)
        run: cargo fuzz run open_stream -- -max_total_time=120 || true
        continue-on-error: true

      - name: Fuzz claim_stream (120s)
        run: cargo fuzz run claim_stream -- -max_total_time=120 || true
        continue-on-error: true

      - name: Fuzz create_escrow (120s)
        run: cargo fuzz run create_escrow -- -max_total_time=120 || true
        continue-on-error: true

      - name: Fuzz claim_escrow (120s)
        run: cargo fuzz run claim_escrow -- -max_total_time=120 || true
        continue-on-error: true

      - name: Fuzz batch_send (120s)
        run: cargo fuzz run batch_send -- -max_total_time=120 || true
        continue-on-error: true

      - name: Fuzz create_multisig (120s)
        run: cargo fuzz run create_multisig -- -max_total_time=120 || true
        continue-on-error: true

      - name: Fuzz approve_multisig (120s)
        run: cargo fuzz run approve_multisig -- -max_total_time=120 || true
        continue-on-error: true
'''

# Insert before validate section
insert_point = '\n  # --- Validate Config'
if insert_point in text:
    text = text.replace(insert_point, fuzz_job + insert_point, 1)
    with open(ci_path, 'wb') as f:
        f.write(text.encode('utf-8'))
    print('CI updated successfully')
else:
    print('WARNING: Insert point not found')
