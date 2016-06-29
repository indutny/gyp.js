#ifdef _WIN32
/* Windows - set up dll import/export decorators. */
__declspec(dllexport)
#endif
int hello() {
  return 0;
}
