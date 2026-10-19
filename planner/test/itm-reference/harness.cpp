// Scratch harness (not part of the repo): runs NTIA's reference ITM on cases from stdin.
#include "include/itm.h"
#include <cstdio>
#include <vector>
int main() {
  int n; if (scanf("%d", &n) != 1) return 1;
  for (int c = 0; c < n; c++) {
    double hTx, hRx, N0, f, eps, sigma, time, loc, sit; int climate, pol, mdvar, np; double xi;
    if (scanf("%lf %lf %d %lf %lf %d %lf %lf %d %lf %lf %lf %d %lf", &hTx,&hRx,&climate,&N0,&f,&pol,&eps,&sigma,&mdvar,&time,&loc,&sit,&np,&xi) != 14) return 2;
    std::vector<double> pfl(np + 3);
    pfl[0] = np; pfl[1] = xi;
    for (int i = 0; i <= np; i++) scanf("%lf", &pfl[i + 2]);
    double A = 0; long warn = 0; IntermediateValues iv = {};
    int rtn = ITM_P2P_TLS_Ex(hTx, hRx, pfl.data(), climate, N0, f, pol, eps, sigma, mdvar, time, loc, sit, &A, &warn, &iv);
    printf("%d %ld %.10f %d %.10f %.10f %.10f %.10f %.10f %.10f %.10f %.10f %.10f %.10f\n", rtn, warn, A, iv.mode,
      iv.A_ref__db, iv.A_fs__db, iv.delta_h__meter, iv.d_hzn__meter[0], iv.d_hzn__meter[1], iv.h_e__meter[0], iv.h_e__meter[1], iv.theta_hzn[0], iv.theta_hzn[1], iv.N_s);
  }
  return 0;
}
