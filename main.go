package main

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"strings"
	"syscall"
	"time"

	"github.com/ActiveState/termtest/expect"
	"github.com/brad-jones/goerr/v2"
	"github.com/brad-jones/goexec/v2"
)

func main() {
	exitCode := 0
	defer func() { os.Exit(exitCode) }()

	defer goerr.Handle(func(err error) {
		goerr.PrintTrace(err)
		exitCode = 1
	})

	keyFilePath := os.Args[1]

	reader := bufio.NewReader(os.Stdin)
	keyPassphrase, err := reader.ReadString('\n')
	goerr.Check(err)

	var b bytes.Buffer
	c, err := expect.NewConsole(expect.WithStdout(&b))
	goerr.Check(err)
	defer c.Close()
	go c.ExpectEOF()

	cmd := goexec.MustCmd("ssh-add",
		goexec.SetIn(c.Tty()),
		goexec.SetOut(c.Tty()),
		goexec.SetErr(c.Tty()),
		goexec.Args(keyFilePath),
	)

	defer func() {
		if cmd.ProcessState != nil && !cmd.ProcessState.Exited() {
			if err := cmd.Process.Kill(); err != nil {
				if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
					fmt.Fprintln(os.Stderr, "warning: ssh-add not killed")
				}
			}
		}
	}()

	goerr.Check(c.Pty.StartProcessInTerminal(cmd))

	sentPass := false
	identityAdded := false

	for {
		time.Sleep(time.Microsecond)
		stdout := string(b.Bytes())

		if !sentPass && strings.Contains(stdout, "Enter passphrase for") {
			_, err = c.SendLine(keyPassphrase)
			goerr.Check(err)
			sentPass = true
		}

		if sentPass && strings.Contains(stdout, "Identity added") {
			identityAdded = true
			break
		}

		if sentPass && strings.Contains(stdout, "Bad passphrase") {
			fmt.Fprintln(os.Stderr, "bad passphrase")
			exitCode = 1
			break
		}
	}

	if identityAdded {
		goerr.Check(cmd.Wait())
	}
}
