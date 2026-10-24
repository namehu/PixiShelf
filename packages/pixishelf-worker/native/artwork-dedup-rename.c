#define _GNU_SOURCE
#include <node_api.h>
#include <errno.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#if defined(__linux__)
#include <sys/syscall.h>
#endif

static const char *error_code(int error) {
  switch (error) {
    case EEXIST: return "EEXIST";
    case EXDEV: return "EXDEV";
    case ENOSYS: return "ENOSYS";
    case EINVAL: return "EINVAL";
    case ENOTSUP: return "ENOTSUP";
    case ENOENT: return "ENOENT";
    case ENOTDIR: return "ENOTDIR";
    case EACCES: return "EACCES";
    case EPERM: return "EPERM";
    case EROFS: return "EROFS";
    case ENOSPC: return "ENOSPC";
    case EIO: return "EIO";
    case ELOOP: return "ELOOP";
    case EBADF: return "EBADF";
    default: return "ERR_FILESYSTEM";
  }
}

/* Every at-call accepts one component, never an absolute or multi-component path. */
static int name_arg(napi_env env, napi_value value, char *name, size_t capacity) {
  size_t length = 0, written = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok ||
      length == 0 || length >= capacity ||
      napi_get_value_string_utf8(env, value, name, capacity, &written) != napi_ok ||
      written != length || strlen(name) != length || strchr(name, '/') || strchr(name, '\\') ||
      strcmp(name, ".") == 0 || strcmp(name, "..") == 0) return 0;
  return 1;
}

static napi_value rename_exclusive(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4], result;
  int32_t from_fd, to_fd;
  char from[4096], to[4096];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 4 ||
      napi_get_value_int32(env, argv[0], &from_fd) != napi_ok || from_fd < 0 ||
      !name_arg(env, argv[1], from, sizeof(from)) ||
      napi_get_value_int32(env, argv[2], &to_fd) != napi_ok || to_fd < 0 ||
      !name_arg(env, argv[3], to, sizeof(to))) {
    napi_throw_type_error(env, "ERR_INVALID_ARG", "Expected directory descriptors and single-component names");
    return NULL;
  }
  int status;
#if defined(__linux__) && defined(SYS_renameat2)
  status = (int)syscall(SYS_renameat2, from_fd, from, to_fd, to, 1U /* RENAME_NOREPLACE */);
#elif defined(__APPLE__)
  status = renameatx_np(from_fd, from, to_fd, to, RENAME_EXCL);
#else
  errno = ENOSYS;
  status = -1;
#endif
  if (status != 0) {
    const int error = errno;
    napi_throw_error(env, error_code(error), strerror(error));
    return NULL;
  }
  napi_get_undefined(env, &result);
  return result;
}

static napi_value fail_errno(napi_env env, int error) {
  napi_throw_error(env, error_code(error), strerror(error));
  return NULL;
}
static int directory_args(napi_env env, napi_callback_info info, int32_t *fd, char *name) {
  size_t argc = 2;
  napi_value argv[2];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 2 ||
      napi_get_value_int32(env, argv[0], fd) != napi_ok || *fd < 0 ||
      !name_arg(env, argv[1], name, 4096)) {
    napi_throw_type_error(env, "ERR_INVALID_ARG", "Expected a directory descriptor and single-component name");
    return 0;
  }
  return 1;
}
static napi_value open_directory_at(napi_env env, napi_callback_info info) {
  int32_t parent;
  char name[4096];
  if (!directory_args(env, info, &parent, name)) return NULL;
  struct stat before, after;
  if (fstat(parent, &before) != 0) return fail_errno(env, errno);
  int fd = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fd == -1) return fail_errno(env, errno);
  if (fstat(fd, &after) != 0) { int error = errno; close(fd); return fail_errno(env, error); }
  if (before.st_dev != after.st_dev) { close(fd); return fail_errno(env, EXDEV); }
  napi_value result;
  if (napi_create_int32(env, fd, &result) != napi_ok) { close(fd); return NULL; }
  return result;
}
static napi_value mkdir_at(napi_env env, napi_callback_info info) {
  int32_t parent;
  char name[4096];
  if (!directory_args(env, info, &parent, name)) return NULL;
  if (mkdirat(parent, name, 0700) != 0) return fail_errno(env, errno);
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}
static napi_value create_file_at(napi_env env, napi_callback_info info) {
  int32_t parent;
  char name[4096];
  if (!directory_args(env, info, &parent, name)) return NULL;
  int fd = openat(parent, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd == -1) return fail_errno(env, errno);
  napi_value result;
  if (napi_create_int32(env, fd, &result) != napi_ok) { close(fd); return NULL; }
  return result;
}
static napi_value remove_at(napi_env env, napi_callback_info info, int flags) {
  int32_t parent;
  char name[4096];
  if (!directory_args(env, info, &parent, name)) return NULL;
  if (unlinkat(parent, name, flags) != 0) return fail_errno(env, errno);
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}
static napi_value unlink_at(napi_env env, napi_callback_info info) { return remove_at(env, info, 0); }
static napi_value rmdir_at(napi_env env, napi_callback_info info) { return remove_at(env, info, AT_REMOVEDIR); }
/* Frozen identity check and unlink share one synchronous reader call. External writers
 * must remain stopped: POSIX does not provide inode-conditional unlink. */
static napi_value checked_unlink_at(napi_env env, napi_callback_info info) {
  size_t argc = 4; napi_value argv[4], result, value; int32_t parent;
  char name[4096]; uint64_t expected[6]; bool lossless, allow_missing;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 4 ||
      napi_get_value_int32(env, argv[0], &parent) != napi_ok || parent < 0 ||
      !name_arg(env, argv[1], name, sizeof(name)) ||
      napi_get_value_bool(env, argv[3], &allow_missing) != napi_ok) {
    napi_throw_type_error(env,"ERR_INVALID_ARG","Invalid delete request"); return NULL;
  }
  for (uint32_t i=0;i<6;i++) {
    if(napi_get_element(env,argv[2],i,&value)!=napi_ok || napi_get_value_bigint_uint64(env,value,&expected[i],&lossless)!=napi_ok || !lossless) {
      napi_throw_type_error(env,"ERR_INVALID_ARG","Invalid frozen identity"); return NULL;
    }
  }
  /* Prove directory durability before the irreversible syscall. */
  if(fsync(parent)!=0) return fail_errno(env,errno);
  struct stat st;
  if(fstatat(parent,name,&st,AT_SYMLINK_NOFOLLOW)!=0) {
    if(errno!=ENOENT || !allow_missing) return fail_errno(env,errno);
  } else {
#if defined(__APPLE__)
    uint64_t mt=(uint64_t)st.st_mtimespec.tv_sec*1000000000ULL+st.st_mtimespec.tv_nsec;
    uint64_t ct=(uint64_t)st.st_ctimespec.tv_sec*1000000000ULL+st.st_ctimespec.tv_nsec;
#else
    uint64_t mt=(uint64_t)st.st_mtim.tv_sec*1000000000ULL+st.st_mtim.tv_nsec;
    uint64_t ct=(uint64_t)st.st_ctim.tv_sec*1000000000ULL+st.st_ctim.tv_nsec;
#endif
    if(!S_ISREG(st.st_mode) || st.st_nlink!=1 ||
       (uint64_t)st.st_dev!=expected[0] || (uint64_t)st.st_ino!=expected[1] ||
       (uint64_t)st.st_size!=expected[2] || mt!=expected[3] || ct!=expected[4] || (uint64_t)st.st_nlink!=expected[5]) {
      napi_throw_error(env,"FILE_CHANGED","Frozen file identity changed"); return NULL;
    }
    if(unlinkat(parent,name,0)!=0) return fail_errno(env,errno);
  }
  if(fsync(parent)!=0) return fail_errno(env,errno);
  napi_get_undefined(env,&result); return result;
}
static napi_value initialize(napi_env env, napi_value exports) {
  const struct { const char *name; napi_callback callback; } methods[] = {
    { "renameExclusive", rename_exclusive }, { "openDirectoryAt", open_directory_at },
    { "mkdirAt", mkdir_at }, { "createFileAt", create_file_at },
    { "checkedUnlinkAt", checked_unlink_at }, { "unlinkAt", unlink_at }, { "rmdirAt", rmdir_at }
  };
  for (size_t i = 0; i < sizeof(methods) / sizeof(methods[0]); i++) {
    napi_value function;
    if (napi_create_function(env, methods[i].name, NAPI_AUTO_LENGTH, methods[i].callback, NULL, &function) != napi_ok ||
        napi_set_named_property(env, exports, methods[i].name, function) != napi_ok) return NULL;
  }
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
