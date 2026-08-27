module.exports = function (grunt) {
    grunt.initConfig({
        exec: {
            tsc: {
                command: "tsc -p tsconfig.json",
                stdout: true,
                stderr: true
            },
            bundle: {
                command: "node bundle-scripts.js",
                stdout: true,
                stderr: true
            },
            package_dev: {
                command: "tfx extension create --root ../build --rev-version --manifests vss-extension.json --overrides-file configs/dev.json --output-path ../dist" ,
                stdout: true,
                stderr: true
            },
            package_release: {
                command: "tfx extension create --root ../build --manifests vss-extension.json --overrides-file configs/release.json --output-path ../dist",
                stdout: true,
                stderr: true
            },
            publish_dev: {
                command: "tfx extension publish --root ../build --service-url https://marketplace.visualstudio.com --manifests vss-extension.json --overrides-file configs/dev.json --output-path ../dist",
                stdout: true,
                stderr: true
            },
            publish_release: {
                command: "tfx extension publish --root ../build --service-url https://marketplace.visualstudio.com --manifests vss-extension.json --overrides-file configs/release.json --output-path ../dist",
                stdout: true,
                stderr: true
            },
            serve: {
                command: "http-server ../build -S -C certs/cert.pem -K certs/key.pem -p 5501 -a localhost -c-1",
                stdout: true,
                stderr: true
            }
        },
        copy: {
            static: {
                files: [
                    { src: "toolbar.html", dest: "../build/toolbar.html" },
                    { src: "vss-extension.json", dest: "../build/vss-extension.json" },
                    { src: "overview.md", dest: "../build/overview.md" },
                    { expand: true, cwd: "img", src: ["**"], dest: "../build/img" },
                    {
                        expand: true,
                        flatten: true,
                        src: ["node_modules/vss-web-extension-sdk/lib/VSS.SDK.min.js"],
                        dest: "../build/lib",
                        filter: "isFile"
                    }
                ]
            }
        },

        clean: {
            options: {
                force: true
            },
            vsix: ["../dist/*.vsix"],
            build: ["../build"]
        }
    });
    
    grunt.loadNpmTasks("grunt-exec");
    grunt.loadNpmTasks("grunt-contrib-copy");
    grunt.loadNpmTasks('grunt-contrib-clean');

    grunt.registerTask("build", ["clean:build", "exec:tsc", "exec:bundle", "copy:static"]);
    grunt.registerTask("package-dev", ["build", "exec:package_dev"]);
    grunt.registerTask("package-release", ["build", "exec:package_release"]);
    grunt.registerTask("publish-dev", ["package-dev", "exec:publish_dev"]);        
    grunt.registerTask("publish-release", ["package-release", "exec:publish_release"]);        
    grunt.registerTask("serve", ["build", "exec:serve"]);
    
    grunt.registerTask("default", ["package-dev"]);
};