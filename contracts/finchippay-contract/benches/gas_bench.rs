use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn bench_contract_call(c: &mut Criterion) {
    let mut group = c.benchmark_group("finchippay_contract");
    group.bench_function("empty_op", |b| b.iter(|| black_box(1u64 + 1u64)));
    group.finish();
}

criterion_group!(benches, bench_contract_call);
criterion_main!(benches);
