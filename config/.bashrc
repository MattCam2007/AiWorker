# ~/.bashrc: shell prompt and color configuration

# If not running interactively, don't do anything
case $- in
    *i*) ;;
      *) return;;
esac

# set variable identifying the chroot you work in (used in the prompt below)
if [ -z "${debian_chroot:-}" ] && [ -r /etc/debian_chroot ]; then
    debian_chroot=$(cat /etc/debian_chroot)
fi

# set a fancy prompt (non-color, unless we know we "want" color)
case "$TERM" in
    xterm-color|*-256color) color_prompt=yes;;
esac

# Function to get git prompt info
git_prompt_info() {
  local color="34"  # blue

  # Check if inside a Git repository
  if git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    # Get the current branch name
    local branch=$(git symbolic-ref --short HEAD 2>/dev/null || git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD 2>/dev/null)

    # Check for uncommitted changes (staged, unstaged, or untracked)
    if [[ -n $(git status --porcelain 2>/dev/null) ]]; then
      color="31"  # red
    fi

    # Display the branch with color
    if [[ -n $branch ]]; then
      echo -e "\[\e[${color}m\](${branch})\[\e[0m\] "
    fi
  fi
}

# Set the prompt
PS1='\[\e[36m\]\u\[\e[37m\]@\[\e[32m\]\h\[\e[0m\]: \[\e[36m\]\w\[\e[0m\] $(git_prompt_info)\[\e[33m\]%\[\e[0m\] '

unset color_prompt force_color_prompt

# If this is an xterm set the title to user@host:dir
case "$TERM" in
xterm*|rxvt*)
    PS1="\[\e]0;${debian_chroot:+($debian_chroot)}\u@\h: \w\a\]$PS1"
    ;;
*)
    ;;
esac

# enable color support of ls and also add handy aliases
if [ -x /usr/bin/dircolors ]; then
    test -r ~/.dircolors && eval "$(dircolors -b ~/.dircolors)" || eval "$(dircolors -b)"
    alias ls='ls --color=auto'
    alias grep='grep --color=auto'
    alias fgrep='fgrep --color=auto'
    alias egrep='egrep --color=auto'
fi

alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'

# Claude Code CLI
export PATH="/root/.claude/local/bin:$PATH"
