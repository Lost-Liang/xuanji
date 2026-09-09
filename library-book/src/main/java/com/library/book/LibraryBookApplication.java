package com.library.book;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 图书管理系统启动类
 */
@SpringBootApplication
@MapperScan("com.library.book.mapper")
public class LibraryBookApplication {

    public static void main(String[] args) {
        SpringApplication.run(LibraryBookApplication.class, args);
    }
}