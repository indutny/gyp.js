#ifdef _WIN32
/* Windows - set up dll import/export decorators. */
__declspec(dllimport)
#endif
int hello();
