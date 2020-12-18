class SshAddWithPass < Formula
    desc "Wrapper around ssh-add that uses expect to unlock the provided key."
    homepage "https://github.com/brad-jones/ssh-add-with-pass"
    url "https://github.com/brad-jones/ssh-add-with-pass/releases/download/v${VERSION}/ssh_add_with_pass_darwin_amd64.tar.gz"
    version "${VERSION}"
    sha256 "${HASH}"

    def install
        bin.install "ssh_add_with_pass"
    end

    test do
        system "#{bin}/ssh_add_with_pass -v"
    end
end
