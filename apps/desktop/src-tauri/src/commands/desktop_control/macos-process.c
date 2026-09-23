#include "macos.h"
#include <CoreGraphics/CGEventSource.h>
#include <libproc.h>
#include <stdio.h>
#include <unistd.h>

int jackalope_process_start(int pid, char *buffer, int capacity) {
    struct proc_bsdinfo info = {0};
    if (pid <= 0 || proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != (int)sizeof(info)
        || info.pbi_uid != geteuid()) return 0;
    int count = snprintf(buffer, capacity, "%llu.%llu",
        (unsigned long long)info.pbi_start_tvsec, (unsigned long long)info.pbi_start_tvusec);
    return count > 0 && count < capacity;
}

int jackalope_mouse_buttons_down(void) {
    for (unsigned int button = 0; button < 32; ++button) {
        if (CGEventSourceButtonState(kCGEventSourceStateCombinedSessionState, (CGMouseButton)button)) return 1;
    }
    return 0;
}
