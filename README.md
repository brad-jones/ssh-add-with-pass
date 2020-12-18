# ssh-add-with-pass

![.github/workflows/main.yml](https://github.com/brad-jones/ssh-add-with-pass/workflows/.github/workflows/main.yml/badge.svg)

Wrapper around `ssh-add` that uses expect to unlock the provided key.

## Installation

### Direct download

Go to <https://github.com/brad-jones/ssh-add-with-pass/releases> and download
the archive for your Operating System, extract the binary and and add it to
your `$PATH`.

### Curl Bash

```
curl -L https://github.com/brad-jones/ssh-add-with-pass/releases/latest/download/ssh_add_with_pass_linux_amd64.tar.gz -o- | sudo tar -xz -C /usr/bin/ssh_add_with_pass
```

### RPM package

```
sudo rpm -i https://github.com/brad-jones/ssh-add-with-pass/releases/latest/download/ssh_add_with_pass_linux_amd64.rpm
```

### DEB package

```
curl -sLO https://github.com/brad-jones/ssh-add-with-pass/releases/latest/download/ssh_add_with_pass_linux_amd64.deb && sudo dpkg -i ssh_add_with_pass_linux_amd64.deb && rm ssh_add_with_pass_linux_amd64.deb
```

### Homebrew

<https://brew.sh>

```
brew install brad-jones/tap/ssh_add_with_pass
```

### Scoop

<https://scoop.sh>

```
scoop bucket add brad-jones https://github.com/brad-jones/scoop-bucket.git;
scoop install ssh_add_with_pass;
```

## Example Usage

```
echo "a-passphrase" | ssh_add_with_pass ./path/to/your-protected-key
```

**DO NOT ACTUALLY DO THIS!**

The idea is not to use it in a shell command like this otherwise you just leave
your passphrase behind in history. The intended purpose is to call this command
from other automation tools that would then provide the pass phrase via STDIN.
